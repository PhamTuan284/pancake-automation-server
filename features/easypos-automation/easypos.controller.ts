import type { Request, Response } from 'express';
import { runFixEasyposCustomerNames } from './easyposRunner.service';

export async function postRunCustomerNameFix(req: Request, res: Response): Promise<void> {
  const apply = req.body?.apply !== false;
  try {
    const result = await runFixEasyposCustomerNames(apply);
    res.json({ status: 'completed', apply, output: result.output });
  } catch (err) {
    if (err instanceof Error && err.message.includes('already running')) {
      res.status(409).json({ error: err.message });
      return;
    }
    const detail = err instanceof Error ? err.message : 'EasyPOS automation failed.';
    res.status(500).json({ error: detail });
  }
}
