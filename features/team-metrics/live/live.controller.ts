import type { Request, Response } from 'express';
import { computeLiveAttendance, getLiveAttendanceReport } from './live.service';
import { DriveConfigError } from '../../drive/drive.service';
import { FacebookConfigError } from '../../facebook/facebook.service';

export async function postUploadTikTok(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;
    const referenceDate = String(req.body?.referenceDate ?? '').trim();
    if (!file) {
      res.status(400).json({ error: 'Cần chọn file Excel báo cáo TikTok.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      res.status(400).json({ error: 'Cần gửi referenceDate (YYYY-MM-DD) để xác định năm của lịch phân công.' });
      return;
    }
    const summary = await computeLiveAttendance(file.buffer, referenceDate);
    res.json({ ok: true, summary });
  } catch (err) {
    if (err instanceof DriveConfigError || err instanceof FacebookConfigError) {
      res.status(500).json({ error: err.message });
      return;
    }
    console.error('[team-metrics/live/upload-tiktok]', err);
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
    const report = await getLiveAttendanceReport(from, to);
    res.json({ report });
  } catch (err) {
    console.error('[team-metrics/live/report]', err);
    res.status(500).json({ error: 'Lỗi server.' });
  }
}
