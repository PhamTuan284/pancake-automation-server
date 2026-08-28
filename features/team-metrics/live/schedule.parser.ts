import * as XLSX from 'xlsx';

export type ScheduleSlot = {
  platform: 'tiktok' | 'facebook';
  date: string; // "YYYY-MM-DD"
  startMinutes: number;
  endMinutes: number | null; // null = open-ended ("hết traffic")
  label: string;
  employees: string[];
};

export type ScheduleParseResult = {
  slots: ScheduleSlot[];
  parsedTabs: { tab: string; weekStart: string }[];
  skippedTabs: { tab: string; reason: string }[];
};

function splitNames(cell: unknown): string[] {
  return String(cell ?? '')
    .replace(/\([^)]*\)/g, '') // drop parenthetical notes like "(Từ 19h- hết traffic)"
    .split(/[-,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function weekdayOf(y: number, m: number, d: number): number {
  // 0 = Sunday, 1 = Monday, ...
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The schedule workbook's week-tab names encode a date range with no
 * separator and no year (e.g. "108- 168" = "10/8 - 16/8"), ambiguous by
 * construction (both a 1/8 and 10/8 reading of "108" are numerically valid).
 * We disambiguate using the one fact we know for certain: column index 2 of
 * every tab is always "Thứ 2" (Monday) — so the tab's start date MUST fall on
 * a Monday. We also anchor the year using the caller's requested date range,
 * since the tab name never states one.
 */
function resolveTabStartDate(tabName: string, referenceYears: number[]): string | null {
  const digits = tabName.trim().split('-')[0]?.replace(/\s/g, '') ?? '';
  if (!/^\d{3,4}$/.test(digits)) return null;

  const candidates: { day: number; month: number }[] = [];
  for (let i = 1; i < digits.length; i++) {
    const day = Number(digits.slice(0, i));
    const month = Number(digits.slice(i));
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      candidates.push({ day, month });
    }
  }

  const matches: string[] = [];
  for (const { day, month } of candidates) {
    for (const year of referenceYears) {
      if (weekdayOf(year, month, day) === 1) {
        matches.push(isoDate(year, month, day));
      }
    }
  }
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

function addDaysIso(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function parseTimeLabel(label: string): { startMinutes: number; endMinutes: number | null } | null {
  const startMatch = label.match(/^(\d{1,2})h(\d{1,2})?/);
  if (!startMatch) return null;
  const startHour = Number(startMatch[1]);
  const startMin = startMatch[2] ? Number(startMatch[2]) : 0;
  const endMatch = label.match(/-\s*(\d{1,2})h(\d{1,2})?/);
  const endMinutes = endMatch ? Number(endMatch[1]) * 60 + (endMatch[2] ? Number(endMatch[2]) : 0) : null;
  return { startMinutes: startHour * 60 + startMin, endMinutes };
}

/**
 * Parses every week tab in the schedule workbook into TikTok/Facebook slots.
 * `referenceDateIso` anchors the ambiguous tab-name year (the requested
 * report's start date) — tabs are also tried against the previous year, to
 * cover a schedule that spans a Dec→Jan boundary.
 */
export function parseScheduleWorkbook(buffer: Buffer, referenceDateIso: string): ScheduleParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const referenceYear = Number(referenceDateIso.slice(0, 4));
  const referenceYears = [referenceYear, referenceYear - 1, referenceYear + 1];

  const slots: ScheduleSlot[] = [];
  const parsedTabs: { tab: string; weekStart: string }[] = [];
  const skippedTabs: { tab: string; reason: string }[] = [];

  for (const tabName of workbook.SheetNames) {
    const weekStart = resolveTabStartDate(tabName, referenceYears);
    if (!weekStart) {
      skippedTabs.push({ tab: tabName, reason: 'Không xác định được ngày bắt đầu tuần từ tên sheet.' });
      continue;
    }
    parsedTabs.push({ tab: tabName, weekStart });

    const sheet = workbook.Sheets[tabName];
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

    let platform: 'tiktok' | 'facebook' | null = null;
    for (const row of data) {
      const cat = String(row[0] ?? '').trim();
      const timeLabel = String(row[1] ?? '').trim();
      if (cat.toUpperCase().startsWith('TIKTOK')) platform = 'tiktok';
      else if (cat.toUpperCase().startsWith('FACEBOOK')) platform = 'facebook';
      else if (cat) platform = null; // entered a different block (e.g. "QUAY CHỤP")

      if (!platform || !timeLabel) continue;
      const parsedTime = parseTimeLabel(timeLabel);
      if (!parsedTime) continue;

      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const employees = splitNames(row[2 + dayOffset]);
        if (!employees.length) continue;
        slots.push({
          platform,
          date: addDaysIso(weekStart, dayOffset),
          startMinutes: parsedTime.startMinutes,
          endMinutes: parsedTime.endMinutes,
          label: timeLabel,
          employees,
        });
      }
    }
  }

  return { slots, parsedTabs, skippedTabs };
}
