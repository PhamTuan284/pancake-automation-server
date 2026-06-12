import type { Request, Response } from 'express';
import {
  resolveMeiTVariantForE2e,
  triggerE2eTestRun,
} from './automationRunner.service';
import { resolveInvoiceShopKey } from './invoiceShops';
import * as einvoiceService from './einvoice.service';

function shopKeyFromRequest(req: Request) {
  return resolveInvoiceShopKey(req.params.shopKey);
}

export function getInvoiceShopConfig(req: Request, res: Response): void {
  try {
    const shopKey = shopKeyFromRequest(req);
    res.json(einvoiceService.getShopPanelConfig(shopKey));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid shop';
    res.status(400).json({ error: message });
  }
}

export async function getInvoiceData(
  req: Request,
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
    const shopKey = shopKeyFromRequest(req);
    const rows = await einvoiceService.listInvoiceClients(shopKey);
    res.json({ rows, count: rows.length, shopKey });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid shop')) {
      res.status(400).json({ error: err.message });
      return;
    }
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
    const shopKey = shopKeyFromRequest(req);
    const body = req.body as { rows?: unknown[] } | undefined;
    if (!body || !Array.isArray(body.rows)) {
      res.status(400).json({ error: 'Cần JSON dạng { "rows": [ ... ] }' });
      return;
    }
    const normalized = einvoiceService.normalizeInvoiceRowsFromPayload(
      body.rows
    );
    einvoiceService.assertRowsHaveBuyerOrUnit(normalized);
    await einvoiceService.replaceInvoiceClients(shopKey, normalized);
    res.json({ ok: true, count: normalized.length, shopKey });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Dòng ')) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.startsWith('Invalid shop')) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Không lưu được dữ liệu khách hàng' });
  }
}

export function getInvoiceExcelTemplate(
  req: Request,
  res: Response
): void {
  try {
    shopKeyFromRequest(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid shop';
    res.status(400).json({ error: message });
    return;
  }
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
    const shopKey = shopKeyFromRequest(req);
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
      await einvoiceService.replaceInvoiceClients(shopKey, data);
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
    res.json({ ok: true, count: data.length, shopKey });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid shop')) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    const message =
      err instanceof Error ? err.message : 'Không đọc được file Excel';
    res.status(400).json({ error: message });
  }
}

type RunE2eBody = {
  spec?: string;
  wdioArgs?: string[];
  shop?: string;
  /** MeiT tab only: `mode` (default) or `daily`. */
  meitVariant?: string;
  /** Save mode after filling e-invoice: `draft` (Lưu, default) or `publish` (Lưu và phát hành). */
  saveMode?: string;
};

export async function postRunE2eTests(req: Request, res: Response): Promise<void> {
  try {
    const shopKey = resolveInvoiceShopKey(
      req.params.shopKey ?? (req.body as RunE2eBody)?.shop
    );
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
    const meitVariant = resolveMeiTVariantForE2e(shopKey, body.meitVariant);
    await triggerE2eTestRun(extra, shopKey, meitVariant, body.saveMode);
    res.json({ status: 'completed', shopKey });
  } catch (err) {
    if (err instanceof Error && err.message === 'E2E test already running') {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.startsWith('Invalid shop')) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error('E2E tests failed:', err);
    const detail =
      err instanceof Error ? err.message : 'E2E failed, see server logs.';
    res.status(500).json({ error: detail });
  }
}

/** Legacy routes without :shopKey default to meit. */
export async function getInvoiceDataLegacy(
  req: Request,
  res: Response
): Promise<void> {
  req.params.shopKey = 'meit';
  return getInvoiceData(req, res);
}

export async function putInvoiceDataLegacy(
  req: Request,
  res: Response
): Promise<void> {
  req.params.shopKey = 'meit';
  return putInvoiceData(req, res);
}

export function getInvoiceExcelTemplateLegacy(
  req: Request,
  res: Response
): void {
  req.params.shopKey = 'meit';
  getInvoiceExcelTemplate(req, res);
}

export async function postUploadInvoiceExcelLegacy(
  req: Request,
  res: Response
): Promise<void> {
  req.params.shopKey = 'meit';
  return postUploadInvoiceExcel(req, res);
}

export async function postRunE2eTestsLegacy(
  req: Request,
  res: Response
): Promise<void> {
  req.params.shopKey = 'meit';
  return postRunE2eTests(req, res);
}
