import type { Request, Response } from 'express';
import { isAutomationRunning } from '../features/pancake-einvoice/automationRunner.service';

export function getHealth(_req: Request, res: Response): void {
  res.json({ ok: true, automationRunning: isAutomationRunning() });
}
