import express from 'express';
import cors from 'cors';
import multer from 'multer';
import http from 'http';
import { runPancakeFlow } from './pancakeAutomation';
import {
  clearWebhookEvents,
  fetchPancakeOpenApi,
  getLegacyWebhookPanelConfig,
  listWebhookEvents,
  recordWebhookEventWithPersistence,
  registerPancakeWebhook,
  resolveWebhookReceiverPath,
  shouldAutoRunFromWebhook,
  updatePancakeWebhookConfig,
  verifyWebhookSecret,
  webhookEventStorageSource,
} from './pancakeWebhook';
import {
  parseExcelBuffer,
  normalizeInvoiceRow,
  buildInvoiceExcelTemplateBuffer,
} from './invoiceExcel';
import {
  loadInvoiceClientsFromDb,
  replaceAllRows,
  useMongo,
} from './invoiceStore';
import type { InvoiceRow } from './types/invoice';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file .xlsx hoặc .xls'));
    }
  },
});

let running = false;
const legacyReceiverPath = resolveWebhookReceiverPath();

async function triggerAutomationRun(): Promise<void> {
  if (running) {
    throw new Error('Automation already running');
  }
  running = true;
  try {
    await runPancakeFlow();
  } finally {
    running = false;
  }
}

app.get('/invoice-data', async (_req, res) => {
  if (!useMongo()) {
    return res.status(503).json({
      error:
        'Bảng dữ liệu chỉ đọc từ MongoDB. Đặt MONGODB_URI hoặc MONGO_URL trong .env (server).',
    });
  }
  try {
    const rows = await loadInvoiceClientsFromDb();
    res.json({ rows, count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không đọc được dữ liệu từ MongoDB' });
  }
});

/**
 * Replace all rows in MongoDB `invoice_clients`. Body: { rows: [...] }.
 * Mỗi dòng cần ít nhất Tên khách hàng hoặc Tên đơn vị (sau khi trim).
 */
app.put('/invoice-data', async (req, res) => {
  if (!useMongo()) {
    return res.status(503).json({
      error:
        'Chỉ lưu vào MongoDB. Đặt MONGODB_URI hoặc MONGO_URL trong .env (server).',
    });
  }
  try {
    const body = req.body as { rows?: unknown[] } | undefined;
    if (!body || !Array.isArray(body.rows)) {
      return res
        .status(400)
        .json({ error: 'Cần JSON dạng { "rows": [ ... ] }' });
    }
    const normalized = body.rows.map((r) =>
      normalizeInvoiceRow(r as Partial<InvoiceRow>)
    );
    for (let i = 0; i < normalized.length; i++) {
      const r = normalized[i];
      if (!r.buyerName && !r.operationName) {
        return res.status(400).json({
          error: `Dòng ${i + 1}: cần "Tên khách hàng" hoặc "Tên đơn vị".`,
        });
      }
    }
    await replaceAllRows(normalized);
    res.json({ ok: true, count: normalized.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không lưu được dữ liệu khách hàng' });
  }
});

/** Download empty .xlsx with correct header row for `/upload-invoice-excel`. */
app.get('/invoice-excel-template', (_req, res) => {
  const buf = buildInvoiceExcelTemplateBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="mau-khach-hang-hoa-don-dien-tu.xlsx"'
  );
  res.send(buf);
});

app.post('/upload-invoice-excel', (req, res) => {
  upload.single('file')(req, res, async (multerErr) => {
    if (multerErr) {
      return res.status(400).json({ error: multerErr.message || 'Upload lỗi' });
    }
    if (!useMongo()) {
      return res.status(503).json({
        error:
          'Upload chỉ ghi vào MongoDB. Đặt MONGODB_URI hoặc MONGO_URL trong .env (server).',
      });
    }
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Vui lòng chọn file Excel' });
      }
      const data = parseExcelBuffer(req.file.buffer);
      if (data.length === 0) {
        return res.status(400).json({
          error:
            'Không có dòng dữ liệu hợp lệ (cần ít nhất Tên khách hàng hoặc Tên đơn vị)',
        });
      }
      try {
        await replaceAllRows(data);
      } catch (persistErr) {
        console.error(persistErr);
        return res.status(500).json({
          error:
            persistErr instanceof Error
              ? persistErr.message
              : 'Không lưu được dữ liệu sau upload',
        });
      }
      res.json({ ok: true, count: data.length });
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : 'Không đọc được file Excel';
      res.status(400).json({ error: message });
    }
  });
});

app.post('/run-einvoice-automation', async (_req, res) => {
  try {
    await triggerAutomationRun();
    res.json({ status: 'completed' });
  } catch (err) {
    if (err instanceof Error && err.message === 'Automation already running') {
      return res.status(409).json({ error: err.message });
    }
    console.error('Automation failed:', err);
    res.status(500).json({ error: 'Automation failed, see server logs.' });
  }
});

/**
 * Update Pancake shop webhook config via OpenAPI:
 * PUT https://pos.pages.fm/api/v1/shops/{SHOP_ID}?api_key=...
 * Body: { shop: { webhook_enable, webhook_url, webhook_types, ... } }
 */
app.put('/pancake/webhook/config', async (req, res) => {
  try {
    const result = await updatePancakeWebhookConfig(
      (req.body || {}) as Record<string, unknown>
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to update webhook config';
    res.status(400).json({ ok: false, error: message });
  }
});

app.get('/pancake-webhook/config', (_req, res) => {
  res.json(getLegacyWebhookPanelConfig());
});

app.post('/pancake-webhook/register', async (req, res) => {
  try {
    const result = await registerPancakeWebhook(
      (req.body || {}) as Record<string, unknown>
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to register webhook';
    res.status(400).json({ ok: false, error: message });
  }
});

function buildQueryFromRequest(req: express.Request): URLSearchParams {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v != null && String(v).trim() !== '') {
          q.append(key, String(v));
        }
      }
    } else if (String(value).trim() !== '') {
      q.set(key, String(value));
    }
  }
  return q;
}

async function proxyPancakeGet(
  req: express.Request,
  res: express.Response,
  pathname: string
) {
  try {
    const data = await fetchPancakeOpenApi(pathname, buildQueryFromRequest(req));
    res.json({ ok: true, data });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to call Pancake Open API';
    res.status(400).json({ ok: false, error: message });
  }
}

app.get('/pancake-webhook/warehouses', (req, res) => {
  void proxyPancakeGet(req, res, '/warehouses');
});

app.get('/pancake-webhook/einvoices', (req, res) => {
  void proxyPancakeGet(req, res, '/list_einvoices/');
});

app.get('/pancake-webhook/products/variations', (req, res) => {
  void proxyPancakeGet(req, res, '/products/variations');
});

app.get('/pancake-webhook/customers', (req, res) => {
  const q = buildQueryFromRequest(req);
  if (!q.get('page_size')) {
    q.set('page_size', '30');
  }
  if (!q.get('page_number')) {
    q.set('page_number', '1');
  }
  void (async () => {
    try {
      const data = await fetchPancakeOpenApi('/customers', q);
      res.json({ ok: true, data });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to call Pancake Open API';
      res.status(400).json({ ok: false, error: message });
    }
  })();
});

/**
 * Webhook receiver endpoint for Pancake.
 * Configure this URL in Pancake "Webhook/API" setting.
 */
app.post('/pancake/webhook', async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
  }
  const event = await recordWebhookEventWithPersistence(req);
  console.log(`[webhook] Received type=${event.kind} at=${event.at}`);

  if (shouldAutoRunFromWebhook()) {
    if (running) {
      console.log('[webhook] Automation already running, skipping auto-run trigger');
    } else {
      try {
        await triggerAutomationRun();
        console.log('[webhook] Auto-run completed');
      } catch (err) {
        console.error('[webhook] Auto-run failed:', err);
      }
    }
  }

  res.json({ success: true });
});

app.post(legacyReceiverPath, async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
  }
  const event = await recordWebhookEventWithPersistence(req);
  console.log(`[webhook] Received type=${event.kind} at=${event.at}`);
  res.json({ success: true });
});

app.get('/pancake/webhook/events', async (req, res) => {
  const events = await listWebhookEvents(req.query.limit);
  res.json({ count: events.length, events });
});

app.get('/pancake-webhook/events', async (req, res) => {
  const source = webhookEventStorageSource();
  const events = (await listWebhookEvents(req.query.limit)).map((ev, i) => ({
    id: ev.id || `${ev.at}-${i}`,
    receivedAt: ev.at,
    contentType: ev.contentType || String(ev.headers['content-type'] || ''),
    payload: ev.payload,
  }));
  res.json({ events, source });
});

app.delete('/pancake-webhook/events', async (_req, res) => {
  await clearWebhookEvents();
  res.json({ ok: true });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, automationRunning: running });
});

/** Default 4001 so dev works when another app already uses 4000; override with PORT. */
const preferredPort = Number(process.env.PORT) || 4001;
const maxPort = preferredPort + 20;

const server = http.createServer(app);
let port = preferredPort;

server.on('listening', () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`Pancake automation API: http://localhost:${bound}`);
  if (bound !== preferredPort) {
    console.warn(
      `API bound to ${bound} (preferred ${preferredPort} was busy). Point the UI proxy at this port, e.g. PowerShell:\n` +
        `  $env:PANCAKE_API_PORT="${bound}"; npm run dev\n` +
        `  (from folder pancake-automation-ui)`
    );
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') {
    console.error(err);
    process.exit(1);
  }
  if (port >= maxPort) {
    console.error(
      `No free port between ${preferredPort} and ${maxPort}. Stop the process using port ${preferredPort} or set PORT to an open port.`
    );
    process.exit(1);
  }
  console.warn(`Port ${port} in use, trying ${port + 1}…`);
  port += 1;
  server.listen(port);
});

server.listen(port);
