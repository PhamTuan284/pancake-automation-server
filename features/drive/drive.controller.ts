import type { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { downloadScheduleXlsx, DriveConfigError } from './drive.service';

export async function getScheduleSheets(_req: Request, res: Response) {
  try {
    const buffer = await downloadScheduleXlsx();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    res.json({ sheetNames: workbook.SheetNames });
  } catch (err) {
    if (err instanceof DriveConfigError) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : 'Lỗi không xác định.' });
  }
}
