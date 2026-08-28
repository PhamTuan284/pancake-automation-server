import type { Request, Response } from 'express';
import { computeOfficeAttendance, getOfficeAttendanceReport, AttendanceParserNotConfiguredError } from './office.service';

export async function postUploadAttendance(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Cần chọn file Excel chấm công.' });
      return;
    }
    const summary = await computeOfficeAttendance(file.buffer);
    res.json({ ok: true, summary });
  } catch (err) {
    if (err instanceof AttendanceParserNotConfiguredError) {
      res.status(501).json({ error: err.message });
      return;
    }
    console.error('[team-metrics/office/upload]', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Lỗi không xác định.' });
  }
}

export async function getReport(req: Request, res: Response): Promise<void> {
  try {
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: 'Cần truyền from/to dạng YYYY-MM-DD.' });
      return;
    }
    const report = await getOfficeAttendanceReport(from, to);
    res.json({ report });
  } catch (err) {
    console.error('[team-metrics/office/report]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}
