import type { Request, Response } from 'express';
import {
  getZaloBotConfig,
  getZaloSendLogs,
  dispatchZaloSend,
  fetchZaloUpdates,
  setZaloWebhook,
  sendProductStockToZalo,
  sendZaloPhotoBase64,
  type ZaloProductStockPayload,
} from './zalo-bot.service';

export function getConfig(_req: Request, res: Response): void {
  res.json({ ok: true, ...getZaloBotConfig() });
}

export function getLogs(_req: Request, res: Response): void {
  res.json({ ok: true, logs: getZaloSendLogs() });
}

export async function postSendTest(_req: Request, res: Response): Promise<void> {
  const result = await dispatchZaloSend('test');
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, text: result.text });
}

export async function postSetWebhook(req: Request, res: Response): Promise<void> {
  const url = String((req.body as Record<string, unknown>)?.url ?? '').trim();
  if (!url) {
    res.status(400).json({ ok: false, error: 'Thiếu trường url.' });
    return;
  }
  const result = await setZaloWebhook(url);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, secretToken: result.secretToken });
}

export async function postGetUpdates(_req: Request, res: Response): Promise<void> {
  const result = await fetchZaloUpdates();
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, chats: result.chats });
}

export async function postSendReport(_req: Request, res: Response): Promise<void> {
  const result = await dispatchZaloSend('report');
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, text: result.text });
}

export async function postSendProductStock(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Partial<ZaloProductStockPayload & { imageBase64?: string }>;

  // Image-first path: client captured a canvas screenshot
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
  if (imageBase64) {
    const caption = typeof body.productName === 'string' && body.productName.trim()
      ? body.productName.trim()
      : (typeof body.productCode === 'string' ? body.productCode.trim() : '');
    const result = await sendZaloPhotoBase64(imageBase64, caption);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true });
    return;
  }

  // Fallback: text-based report
  const productCode = String(body.productCode ?? '').trim();
  const productName = String(body.productName ?? '').trim();
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (!productCode && !productName) {
    res.status(400).json({ ok: false, error: 'Thiếu productCode hoặc productName.' });
    return;
  }
  if (variants.length === 0) {
    res.status(400).json({ ok: false, error: 'Cần ít nhất một biến thể.' });
    return;
  }
  const payload: ZaloProductStockPayload = {
    productCode,
    productName: productName || productCode,
    imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl.trim() || null : null,
    price: typeof body.price === 'string' ? body.price : '—',
    variants: variants.map((v) => ({
      label: String((v as Record<string, unknown>).label ?? '').trim(),
      displayId: String((v as Record<string, unknown>).displayId ?? '').trim(),
      stock: typeof (v as Record<string, unknown>).stock === 'number'
        ? ((v as Record<string, unknown>).stock as number)
        : null,
    })),
  };
  const result = await sendProductStockToZalo(payload);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, text: result.text });
}
