import type { Request, Response } from 'express';
import { EasyInvoiceConfigError } from './easyinvoice.config';
import {
  callEasyInvoice,
  EASYINVOICE_OPERATIONS,
  isEasyInvoiceOperation,
  testConnection,
} from './easyinvoice.service';

function handleError(err: unknown, res: Response) {
  if (err instanceof EasyInvoiceConfigError) {
    res.status(500).json({ error: err.message });
    return;
  }
  res.status(502).json({ error: err instanceof Error ? err.message : 'Lỗi không xác định.' });
}

export async function postTestConnection(_req: Request, res: Response) {
  try {
    res.json(await testConnection());
  } catch (err) {
    handleError(err, res);
  }
}

export async function postCall(req: Request, res: Response) {
  const { operation, payload } = req.body ?? {};
  if (!isEasyInvoiceOperation(operation)) {
    res.status(400).json({ error: `Operation không hợp lệ. Hỗ trợ: ${Object.keys(EASYINVOICE_OPERATIONS).join(', ')}` });
    return;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ error: 'payload phải là một JSON object.' });
    return;
  }
  try {
    res.json(await callEasyInvoice(EASYINVOICE_OPERATIONS[operation], payload as Record<string, unknown>));
  } catch (err) {
    handleError(err, res);
  }
}
