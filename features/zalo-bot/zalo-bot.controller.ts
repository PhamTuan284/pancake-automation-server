import type { Request, Response } from 'express';
import { getZaloBotConfig, getZaloSendLogs, dispatchZaloSend, fetchZaloUpdates, setZaloWebhook } from './zalo-bot.service';

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
