import express from 'express';
import cors from 'cors';
import multer from 'multer';
import http from 'http';
import { runPancakeFlow } from './pancakeAutomation';
import {
  parseExcelBuffer,
  saveInvoiceDataToDisk,
  loadInvoiceDataNormalized,
  normalizeInvoiceRow,
} from './invoiceExcel';
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

app.get('/invoice-data', (_req, res) => {
  try {
    const rows = loadInvoiceDataNormalized();
    res.json({ rows, count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không đọc được invoiceData.json' });
  }
});

/**
 * Replace entire invoiceData.json. Body: { rows: [...] }.
 * Mỗi dòng cần ít nhất Tên khách hàng hoặc Tên đơn vị (sau khi trim).
 */
app.put('/invoice-data', (req, res) => {
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
    saveInvoiceDataToDisk(normalized);
    res.json({ ok: true, count: normalized.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không lưu được invoiceData.json' });
  }
});

app.post('/upload-invoice-excel', (req, res) => {
  upload.single('file')(req, res, (multerErr) => {
    if (multerErr) {
      return res.status(400).json({ error: multerErr.message || 'Upload lỗi' });
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
      saveInvoiceDataToDisk(data);
      res.json({ ok: true, count: data.length });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Không đọc được file Excel';
      res.status(400).json({ error: message });
    }
  });
});

app.post('/run-einvoice-automation', async (_req, res) => {
  if (running) {
    return res.status(409).json({ error: 'Automation already running' });
  }
  running = true;
  try {
    await runPancakeFlow();
    res.json({ status: 'completed' });
  } catch (err) {
    console.error('Automation failed:', err);
    res.status(500).json({ error: 'Automation failed, see server logs.' });
  } finally {
    running = false;
  }
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
