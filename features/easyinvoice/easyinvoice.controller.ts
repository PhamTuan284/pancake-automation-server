import type { Request, Response } from 'express';
import { EasyInvoiceConfigError } from './easyinvoice.config';
import { checkInvoiceState, testConnection } from './easyinvoice.service';

function handleError(err: unknown, res: Response) {
  if (err instanceof EasyInvoiceConfigError) {
    res.status(500).json({ error: err.message });
    return;
  }
  res.status(502).json({ error: err instanceof Error ? err.message : 'Lỗi không xác định.' });
}

export async function postTestConnection(_req: Request, res: Response) {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
}

export async function postCheckStatus(req: Request, res: Response) {
  const { pattern, serial, ikey } = req.body ?? {};
  if (!pattern || !serial || !ikey) {
    res.status(400).json({ error: 'Thiếu pattern / serial / ikey.' });
    return;
  }
  try {
    const result = await checkInvoiceState({ pattern, serial, ikey });
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
}
