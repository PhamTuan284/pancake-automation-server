import type { Request, Response } from 'express';
import { triggerE2eTestRun } from './automationRunner.service';
import * as einvoiceService from './einvoice.service';

export async function getInvoiceData(
  _req: Request,
  res: Response
): Promise<void> {
  if (!einvoiceService.mongoEnabled()) {
    res.status(503).json({
      error:
        'Bảng dữ liệu chỉ đọc từ MongoDB. Đặt MONGODB_URI hoặc MONGO_URL trong .env (server).',
    });
    return;
  }
  try {
    const rows = await einvoiceService.listInvoiceClients();
    res.json({ rows, count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không đọc được dữ liệu từ MongoDB' });
  }
}

export async function putInvoiceData(
  req: Request,
  res: Response
): Promise<void> {
  if (!einvoiceService.mongoEnabled()) {
    res.status(503).json({
      error:
        'Chỉ lưu vào MongoDB. Đặt MONGODB_URI hoặc MONGO_URL trong .env (server).',
    });
    return;
  }
  try {
    const body = req.body as { rows?: unknown[] } | undefined;
    if (!body || !Array.isArray(body.rows)) {
      res.status(400).json({ error: 'Cần JSON dạng { "rows": [ ... ] }' });
      return;
    }
    const normalized = einvoiceService.normalizeInvoiceRowsFromPayload(
      body.rows
    );
    einvoiceService.assertRowsHaveBuyerOrUnit(normalized);
    await einvoiceService.replaceInvoiceClients(normalized);
    res.json({ ok: true, count: normalized.length });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Dòng ')) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Không lưu được dữ liệu khách hàng' });
  }
}

export function getInvoiceExcelTemplate(
  _req: Request,
  res: Response
): void {
  const buf = einvoiceService.invoiceExcelTemplateBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="mau-khach-hang-hoa-don-dien-tu.xlsx"'
  );
  res.send(buf);
}

export async function postUploadInvoiceExcel(
  req: Request,
  res: Response
): Promise<void> {
  if (!einvoiceService.mongoEnabled()) {
    res.status(503).json({
      error:
        'Upload chỉ ghi vào MongoDB. Đặt MONGODB_URI hoặc MONGO_URL trong .env (server).',
    });
    return;
  }
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ error: 'Vui lòng chọn file Excel' });
      return;
    }
    const data = einvoiceService.parseInvoiceExcelBuffer(req.file.buffer);
    if (data.length === 0) {
      res.status(400).json({
        error:
          'Không có dòng dữ liệu hợp lệ (cần ít nhất Tên khách hàng hoặc Tên đơn vị)',
      });
      return;
    }
    try {
      await einvoiceService.replaceInvoiceClients(data);
    } catch (persistErr) {
      console.error(persistErr);
      res.status(500).json({
        error:
          persistErr instanceof Error
            ? persistErr.message
            : 'Không lưu được dữ liệu sau upload',
      });
      return;
    }
    res.json({ ok: true, count: data.length });
  } catch (err) {
    console.error(err);
    const message =
      err instanceof Error ? err.message : 'Không đọc được file Excel';
    res.status(400).json({ error: message });
  }
}

type RunE2eBody = {
  spec?: string;
  wdioArgs?: string[];
};

/**
 * Run WDIO/Cucumber. Optional body:
 * - `{ "spec": "./wdio/features/pancake-einvoice-automation.feature" }` — invoice automation only
 * - `{ "wdioArgs": ["--spec", "./wdio/features/pancake-login.feature"] }` — raw extra args after config
 * Omit body to run all features from `wdio.conf.cjs`.
 */
export async function postRunE2eTests(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body || {}) as RunE2eBody;
    const extra: string[] = [];
    if (typeof body.spec === 'string' && body.spec.trim()) {
      extra.push('--spec', body.spec.trim());
    }
    if (Array.isArray(body.wdioArgs)) {
      for (const a of body.wdioArgs) {
        if (typeof a === 'string' && a.length > 0) {
          extra.push(a);
        }
      }
    }
    await triggerE2eTestRun(extra);
    res.json({ status: 'completed' });
  } catch (err) {
    if (err instanceof Error && err.message === 'E2E test already running') {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error('E2E tests failed:', err);
    const detail =
      err instanceof Error ? err.message : 'E2E failed, see server logs.';
    res.status(500).json({ error: detail });
  }
}
