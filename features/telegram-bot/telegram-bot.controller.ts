import type { Request, Response } from 'express';
import {
  getTelegramBotConfig,
  getTelegramSendLogs,
  dispatchTelegramSend,
} from './telegram-bot.service';

export function getConfig(_req: Request, res: Response): void {
  res.json({ ok: true, ...getTelegramBotConfig() });
}

export function getLogs(_req: Request, res: Response): void {
  res.json({ ok: true, logs: getTelegramSendLogs() });
}

export async function postSendTest(_req: Request, res: Response): Promise<void> {
  const result = await dispatchTelegramSend('test');
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, text: result.text });
}

export async function postSendReport(_req: Request, res: Response): Promise<void> {
  const result = await dispatchTelegramSend('report');
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, text: result.text });
}
