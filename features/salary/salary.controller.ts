import type { Request, Response } from 'express';
import { calculateSalary, getSalaryDefaults } from './salary.service';

export function getSalaryDefaultsController(_req: Request, res: Response): void {
  res.json({ ok: true, defaults: getSalaryDefaults() });
}

export function postSalaryCalculateController(req: Request, res: Response): void {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const result = calculateSalary(body);
    res.json({ ok: true, result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Không thể tính lương';
    res.status(400).json({ ok: false, error: message });
  }
}
