import type { Request, Response } from 'express';
import {
  getZaloBotConfig,
  getZaloSendLogs,
  dispatchZaloSend,
  fetchZaloUpdates,
  setZaloWebhook,
  sendProductStockToZalo,
  sendZaloPhotoBase64,
  sendProductStockMultiToZalo,
  sendDailyStockReport,
  type ZaloProductStockPayload,
} from './zalo-bot.service';
import { getDailyStockConfig, saveDailyStockConfig } from './dailyStockConfig';
import { getAbnormalOrderConfig, saveAbnormalOrderConfig } from './abnormalOrderConfig';
import { sendMockAbnormalOrderAlert } from './abnormalOrderAlert';

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

export async function postSendProductStockMulti(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { images?: unknown };
  const images = Array.isArray(body.images) ? body.images : [];
  const valid = images.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  if (valid.length === 0) {
    res.status(400).json({ ok: false, error: 'Không có ảnh hợp lệ.' });
    return;
  }
  const result = await sendProductStockMultiToZalo(valid);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true });
}

export async function getDailyStockConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getDailyStockConfig();
  res.json({ ok: true, ...config });
}

export async function saveDailyStockConfigHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const productCodes = Array.isArray(body.productCodes)
    ? body.productCodes.filter((x): x is string => typeof x === 'string')
    : undefined;
  const shopKey = typeof body.shopKey === 'string' ? body.shopKey.trim() : undefined;
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;
  const sendTime = typeof body.sendTime === 'string' && /^\d{1,2}:\d{2}$/.test(body.sendTime.trim())
    ? body.sendTime.trim()
    : undefined;

  const updated = await saveDailyStockConfig({
    ...(productCodes !== undefined && { productCodes }),
    ...(shopKey !== undefined && { shopKey }),
    ...(enabled !== undefined && { enabled }),
    ...(sendTime !== undefined && { sendTime }),
  });
  res.json({ ok: true, ...updated });
}

export async function postSendDailyStockNow(_req: Request, res: Response): Promise<void> {
  const result = await sendDailyStockReport('manual');
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, text: result.text });
}

export async function postSendMockAbnormalOrder(_req: Request, res: Response): Promise<void> {
  const result = await sendMockAbnormalOrderAlert();
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, text: result.text });
}

export async function getAbnormalOrderConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getAbnormalOrderConfig();
  res.json({ ok: true, ...config });
}

export async function saveAbnormalOrderConfigHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;
  const thresholdPct =
    typeof body.thresholdPct === 'number' &&
    body.thresholdPct >= 0 &&
    body.thresholdPct <= 100
      ? body.thresholdPct
      : undefined;

  if (enabled === undefined && thresholdPct === undefined) {
    res.status(400).json({ ok: false, error: 'Thiếu trường enabled hoặc thresholdPct.' });
    return;
  }

  const updated = await saveAbnormalOrderConfig({
    ...(enabled !== undefined && { enabled }),
    ...(thresholdPct !== undefined && { thresholdPct }),
  });
  res.json({ ok: true, ...updated });
}
