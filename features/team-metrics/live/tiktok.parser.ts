import * as XLSX from 'xlsx';

export type TikTokSession = {
  platform: 'tiktok';
  sessionId: string;
  start: Date;
  end: Date;
};

/**
 * Parses TikTok Shop's "Creator Live Performance" export. Known layout
 * (from a real sample export): sheet "performance_detail", row index 0 is a
 * date-range title, row 2 is the header, data starts at row 3. Columns:
 * Room ID(0), Room Title(1), Start Time(2), End Time(3), Duration(4), ...
 * Start/End Time are "YYYY-MM-DD HH:mm:ss" strings already in Vietnam local time.
 */
export function parseTikTokReport(buffer: Buffer): TikTokSession[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.includes('performance_detail')
    ? 'performance_detail'
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  const headerRowIndex = rows.findIndex((r) => String(r[0] ?? '').trim() === 'Room ID');
  const dataRows = headerRowIndex >= 0 ? rows.slice(headerRowIndex + 1) : rows.slice(3);

  const sessions: TikTokSession[] = [];
  for (const row of dataRows) {
    const roomId = String(row[0] ?? '').trim();
    const startRaw = row[2];
    const endRaw = row[3];
    if (!roomId || !startRaw) continue;
    const start = new Date(String(startRaw).replace(' ', 'T') + '+07:00');
    const end = new Date(String(endRaw).replace(' ', 'T') + '+07:00');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    sessions.push({ platform: 'tiktok', sessionId: roomId, start, end });
  }
  return sessions;
}
