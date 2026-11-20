import * as XLSX from 'xlsx';
import type {
  ContractType,
  PayComponent,
  PayGroup,
  PayrollEmployee,
  PayrollEntry,
} from './payroll.types';
import { emptyEntry } from './payroll.engine';

/**
 * Reads the monthly payroll workbook ("BẢNG LƯƠNG_MMYYYY.xlsx") into payroll
 * employees (master data + pay components) and that month's entries
 * (metrics). Column positions follow the 10/2026 layout; each team sheet's
 * header is checked first and the sheet is skipped with a warning if it moved.
 * Cached cell values are read, plus formulas where they carry the rate
 * (e.g. `K10*1.5%`, `H10*40000`) so rates survive months with zero revenue.
 */

export type ExcelExpected = { gross: number; tax: number; net: number; sheet: string };

export type ExcelPayrollImport = {
  month: string | null;
  employees: PayrollEmployee[];
  entries: PayrollEntry[];
  expected: Record<string, ExcelExpected>;
  warnings: string[];
};

type Sheet = XLSX.WorkSheet;

/** Employee code as in the workbook (MT001, CTV012): starts with a letter, has a digit. Shared with the service. */
export const CODE_RE = /^(?=[A-Z0-9_-]*\d)[A-Z][A-Z0-9_-]{1,19}$/i;

function cell(ws: Sheet, addr: string): XLSX.CellObject | undefined {
  return ws[addr] as XLSX.CellObject | undefined;
}

function num(ws: Sheet, addr: string): number {
  const v = cell(ws, addr)?.v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[.,\s](?=\d{3}\b)/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(ws: Sheet, addr: string): string {
  const v = cell(ws, addr)?.v;
  return v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function formula(ws: Sheet, addr: string): string {
  return String(cell(ws, addr)?.f ?? '');
}

/** `AE9*1%*60%` → { pct: 0.01, weight: 0.6 }; `J10*0.5%` → { pct: 0.005, weight: 1 }. */
export function pctFromFormula(f: string): { pct: number; weight: number } | null {
  const factors: number[] = [];
  for (const m of f.matchAll(/(\d+(?:\.\d+)?)%/g)) factors.push(Number(m[1]) / 100);
  for (const m of f.matchAll(/\*\s*(0\.\d+)(?![\d%])/g)) factors.push(Number(m[1]));
  if (factors.length === 0) return null;
  const [pct, ...rest] = factors;
  return { pct, weight: rest.reduce((a, b) => a * b, 1) };
}

/** `IF(H8>500000000,H8*1%,0)` → 500000000 */
function thresholdFromFormula(f: string): number | undefined {
  const m = f.match(/IF\(\s*\$?[A-Z]+\$?\d+\s*>\s*(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

/** `H10*40000` → 40000 */
function multiplierFromFormula(f: string): number {
  const m = f.match(/\*\s*(\d{3,})/);
  return m ? Number(m[1]) : 0;
}

function monthFromSheet(ws: Sheet | undefined): string | null {
  if (!ws) return null;
  for (const addr of ['A3', 'A4', 'A5']) {
    const m = str(ws, addr).match(/Tháng\s*(\d{1,2})\s*(?:\/|năm)\s*(\d{4})/i);
    if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/** Rows of a team sheet from `firstRow` until the "Tổng" row. */
function dataRows(ws: Sheet, firstRow: number): number[] {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  const rows: number[] = [];
  for (let r = firstRow; r <= range.e.r + 1; r++) {
    const code = str(ws, `B${r}`);
    if (/^tổng/i.test(code)) break;
    if (CODE_RE.test(code)) rows.push(r);
  }
  return rows;
}

type Collected = {
  code: string;
  team: string;
  fullName: string;
  position: string;
  hdld: boolean;
  payNote: string;
  components: PayComponent[];
  entry: PayrollEntry;
  expected: ExcelExpected;
};

type TeamParser = {
  sheet: string;
  firstRow: number;
  /** header cell → expected text prefix (case-insensitive) */
  header: Record<string, string>;
  parse: (ws: Sheet, r: number, add: Adder) => void;
};

/** Helpers bound to one row: add components / metrics without repeating the plumbing. */
class Adder {
  components: PayComponent[] = [];
  entry: PayrollEntry;
  constructor(code: string) {
    this.entry = emptyEntry(code);
  }
  metric(key: string, value: number) {
    if (value) this.entry.metrics[key] = (this.entry.metrics[key] ?? 0) + value;
  }
  qtyRate(id: string, label: string, metric: string, qty: number, rate: number, group: PayGroup, taxExempt = false) {
    if (!rate && !qty) return;
    this.components.push({ kind: 'qty_rate', id, label, metric, rate, group, ...(taxExempt ? { taxExempt } : {}) });
    this.metric(metric, qty);
  }
  fixed(id: string, label: string, amount: number, group: PayGroup) {
    if (amount) this.components.push({ kind: 'fixed', id, label, amount, group });
  }
  percent(
    id: string,
    label: string,
    metric: string,
    base: number,
    f: string,
    amount: number,
    group: PayGroup,
    threshold?: number
  ) {
    const parsed = pctFromFormula(f) ?? (base > 0 && amount > 0 ? { pct: amount / base, weight: 1 } : null);
    if (!parsed) return;
    this.components.push({
      kind: 'percent',
      id,
      label,
      metric,
      pct: parsed.pct,
      ...(parsed.weight !== 1 ? { weight: Number(parsed.weight.toFixed(6)) } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      group,
    });
    this.metric(metric, base);
  }
}

const isX = (ws: Sheet, addr: string) => str(ws, addr).toLowerCase() === 'x';

/**
 * Base salary by days worked (rate × công), or a flat amount when no daily rate is set.
 * Some months cap it: `MIN(H10*I10,5700000)`.
 */
function workDaysBase(ws: Sheet, r: number, add: Adder, cols: { days: string; rate: string; amount: string }) {
  const rate = num(ws, `${cols.rate}${r}`);
  if (rate > 0) {
    add.qtyRate('cong', 'Lương theo công', 'workDays', num(ws, `${cols.days}${r}`), rate, 'position');
    const cap = formula(ws, `${cols.amount}${r}`).match(/MIN\([^,]+,\s*(\d+)\s*\)/i);
    const c = add.components.at(-1);
    if (cap && c?.kind === 'qty_rate') c.max = Number(cap[1]);
  } else {
    add.fixed('co-dinh', 'Lương cứng / phí cố định', num(ws, `${cols.amount}${r}`), 'position');
    // Still record công: the meal allowance reads it.
    add.metric('workDays', num(ws, `${cols.days}${r}`));
  }
}

const headerIs = (ws: Sheet, addr: string, text: string) => str(ws, addr).toLowerCase().startsWith(text.toLowerCase());

/**
 * Columns the app's own export appends to a team sheet that lacks them
 * (e.g. "Thưởng" on Media). Read only when the header says so, so original
 * workbooks — where those cells mean something else — are unaffected.
 */
function appendedColumns(
  ws: Sheet,
  r: number,
  add: Adder,
  cols: { headerRow: number; other?: string; bonus?: string; carry?: { col: string; net: string } }
) {
  const h = cols.headerRow;
  if (cols.other && headerIs(ws, `${cols.other}${h}`, 'Khoản khác')) {
    add.fixed('khac', 'Khoản khác (ngoài mẫu)', num(ws, `${cols.other}${r}`), 'performance');
  }
  if (cols.bonus && str(ws, `${cols.bonus}${h}`).toLowerCase() === 'thưởng') {
    add.entry.bonus += num(ws, `${cols.bonus}${r}`);
  }
  if (cols.carry && headerIs(ws, `${cols.carry.col}${h}`, 'Bù trừ kỳ trước')) {
    add.entry.carryOver += carryOver(ws, r, cols.carry.col, cols.carry.net);
  }
}

/**
 * "Bù trừ kỳ trước" is added in most months (AB = Z + AA) but subtracted when
 * it settles an overpayment (AB = Z - AA); read the sign off the net formula.
 */
function carryOver(ws: Sheet, r: number, carryCol: string, netCol: string): number {
  const value = num(ws, `${carryCol}${r}`);
  const subtracted = new RegExp(`-\\s*\\$?${carryCol}\\$?${r}(?!\\d)`).test(formula(ws, `${netCol}${r}`));
  return subtracted ? -value : value;
}

function mealAllowance(ws: Sheet, r: number, add: Adder, col: string, daysCol: string) {
  const rate = multiplierFromFormula(formula(ws, `${col}${r}`));
  const amount = num(ws, `${col}${r}`);
  const days = num(ws, `${daysCol}${r}`);
  const perDay = rate || (days > 0 && amount > 0 ? amount / days : 0);
  if (perDay > 0) add.components.push({ kind: 'qty_rate', id: 'an-ca', label: 'Tiền ăn ca', metric: 'workDays', rate: perDay, group: 'meal', taxExempt: true });
}

const MEDIA_TRIPLES: [string, string, string, string, string][] = [
  // qty, rate, amount, metric, fallback label
  ['G', 'H', 'I', 'mediaVideoFull', 'Video quay + dựng'],
  ['J', 'K', 'L', 'mediaShootOrEdit', 'Chỉ quay/dựng/chụp look'],
  ['M', 'N', 'O', 'mediaScript', 'Kịch bản/banner'],
  ['P', 'Q', 'R', 'mediaOutdoorDays', 'Ngày quay outdoor'],
  ['T', 'U', 'V', 'mediaVideoOver', 'Video vượt KPI'],
  ['W', 'X', 'Y', 'mediaShootOrEditExtra', 'Chỉ quay/dựng (thêm)'],
  ['Z', 'AA', 'AB', 'mediaSatellite', 'Quay kênh vệ tinh'],
  ['AC', 'AD', 'AE', 'mediaScriptExtra', 'Kịch bản (thêm)'],
  ['AF', 'AG', 'AH', 'mediaHolidayShoot', 'Quay ngày lễ'],
  ['AI', 'AJ', 'AK', 'mediaPhotoPost', 'Chụp - hậu kỳ'],
  ['AL', 'AM', 'AN', 'mediaPhotoEdit', 'Chụp/hậu kỳ ảnh'],
];

const LIVE_PERCENTS: [string, string, string, string][] = [
  // revenue col, amount col, metric, label
  ['AE', 'AF', 'revenueTiktokLive', '% doanh thu live TikTok'],
  ['AG', 'AH', 'revenueShopeeLive', '% doanh thu live Shopee'],
  ['AI', 'AJ', 'revenueVideoChannel', '% doanh thu kênh video'],
  ['AK', 'AL', 'revenueLiveChannel', '% doanh thu live kênh riêng'],
];

const PARSERS: (TeamParser & { team: string | ((ws: Sheet, r: number) => string); expected: [string, string, string] })[] = [
  {
    sheet: 'LƯƠNG TEAM LIVE',
    team: 'Live',
    firstRow: 9,
    header: { I7: 'Đơn giá', Q7: 'Số giờ live chủ nhật', T7: 'Số giờ live đăng ký thêm', AE7: 'Doanh thu live tiktok' },
    expected: ['AP', 'AR', 'AV'],
    parse(ws, r, add) {
      const rate = num(ws, `I${r}`);
      const std = num(ws, `H${r}`);
      const hdld = isX(ws, `E${r}`);
      if (rate > 0) {
        add.components.push({
          kind: 'live_hours',
          id: 'live',
          label: 'Lương livestream',
          rate,
          ...(hdld ? { standardAmount: std * rate } : {}),
        });
      }
      // Sheet splits hours into standard (H) + day (K) + night (T); the engine wants the total.
      add.metric('liveHours', std + num(ws, `K${r}`) + num(ws, `T${r}`));
      add.metric('nightHours', num(ws, `T${r}`));
      add.metric('sundayHours', num(ws, `Q${r}`));
      add.metric('holidayHours', num(ws, `N${r}`));
      add.qtyRate('video', 'Quay video', 'videos', num(ws, `X${r}`), num(ws, `Y${r}`), 'performance');
      add.qtyRate('video-ot', 'Video OT', 'videosOT', num(ws, `AA${r}`), num(ws, `AB${r}`), 'performance');
      for (const [revCol, amtCol, metric, label] of LIVE_PERCENTS) {
        const base = num(ws, `${revCol}${r}`);
        if (base > 0) add.percent(metric, label, metric, base, formula(ws, `${amtCol}${r}`), num(ws, `${amtCol}${r}`), 'performance');
      }
      add.entry.bonus = num(ws, `AO${r}`);
      add.entry.carryOver = carryOver(ws, r, 'AU', 'AV');
      appendedColumns(ws, r, add, { headerRow: 5, other: 'AW' });
    },
  },
  {
    sheet: 'LƯƠNG TEAM SALE',
    team: 'Sale',
    firstRow: 9,
    header: { H6: 'Số công', K6: 'Doanh thu FB', U5: 'Tiền ăn ca' },
    expected: ['V', 'X', 'AB'],
    parse(ws, r, add) {
      workDaysBase(ws, r, add, { days: 'H', rate: 'I', amount: 'J' });
      add.percent('dt-fb', '% doanh thu FB', 'revenueFB', num(ws, `K${r}`), formula(ws, `L${r}`), num(ws, `L${r}`), 'performance');
      const otRate = num(ws, `N${r}`);
      // Column N sometimes holds a percentage (0.005) instead of an hourly rate; ignore those.
      if (otRate >= 1000) add.qtyRate('ot', 'Lương OT', 'otHours', num(ws, `M${r}`), otRate, 'ot', true);
      add.qtyRate('le', 'Lương ngày lễ', 'holidayOtHours', num(ws, `P${r}`), num(ws, `Q${r}`), 'ot', true);
      mealAllowance(ws, r, add, 'U', 'H');
      add.entry.carryOver = carryOver(ws, r, 'AA', 'AB');
      appendedColumns(ws, r, add, { headerRow: 5, other: 'AC', bonus: 'AD' });
    },
  },
  {
    sheet: 'KHO -KẾ TOÁN',
    team: (ws, r) => (/kế toán/i.test(str(ws, `D${r}`)) ? 'Kế toán' : 'Kho'),
    firstRow: 9,
    header: { H6: 'Số công', K5: 'Tiền ăn ca', N6: 'Lương OT' },
    expected: ['V', 'X', 'AB'],
    parse(ws, r, add) {
      workDaysBase(ws, r, add, { days: 'H', rate: 'I', amount: 'J' });
      mealAllowance(ws, r, add, 'K', 'H');
      add.percent('dt-tong', '% doanh thu tổng', 'revenueCompany', num(ws, `L${r}`), formula(ws, `M${r}`), num(ws, `M${r}`), 'performance');
      add.qtyRate('ot', 'Lương OT', 'otHours', num(ws, `N${r}`), num(ws, `O${r}`), 'ot', true);
      add.qtyRate('le', 'Lương ngày lễ', 'holidayOtHours', num(ws, `Q${r}`), num(ws, `R${r}`), 'ot', true);
      add.entry.carryOver = carryOver(ws, r, 'AA', 'AB');
      appendedColumns(ws, r, add, { headerRow: 5, other: 'AC', bonus: 'AD' });
    },
  },
  {
    sheet: 'LƯƠNG TEAM MARKETING',
    team: 'Marketing',
    firstRow: 8,
    header: { H6: 'Doanh thu FB', N6: 'Phí dịch vụ cố định', P6: 'Tổng lương' },
    expected: ['P', 'Q', 'S'],
    parse(ws, r, add) {
      const pairs: [string, string, string, string, string][] = [
        ['H', 'I', 'revenueFB', 'dt-fb', '% doanh thu FB'],
        ['J', 'K', 'revenueShopee', 'dt-shopee', '% doanh thu Shopee'],
        ['L', 'M', 'revenueTiktok', 'dt-tiktok', '% doanh thu kết chuyển TikTok'],
      ];
      for (const [revCol, amtCol, metric, id, label] of pairs) {
        const f = formula(ws, `${amtCol}${r}`);
        if (!f) continue; // no formula → this person isn't paid on that channel
        add.percent(id, label, metric, num(ws, `${revCol}${r}`), f, num(ws, `${amtCol}${r}`), 'performance', thresholdFromFormula(f));
      }
      add.fixed('co-dinh', 'Phí dịch vụ cố định', num(ws, `N${r}`), 'position');
      add.entry.bonus = num(ws, `O${r}`);
      appendedColumns(ws, r, add, { headerRow: 6, other: 'T', carry: { col: 'R', net: 'S' } });
    },
  },
  {
    sheet: 'LƯƠNG TEAM MEDIA',
    team: 'Media',
    firstRow: 10,
    header: { G5: 'Thu nhập chi trả', G8: 'Số video', AP5: 'Tổng thu nhập' },
    expected: ['AP', 'AQ', 'AS'],
    parse(ws, r, add) {
      MEDIA_TRIPLES.forEach(([qtyCol, rateCol, , metric, fallback], i) => {
        // Columns T onward repeat the same headers under "Thu nhập chi trả thêm theo sản phẩm".
        const header = str(ws, `${qtyCol}7`);
        const label = header ? (i >= 4 ? `${header} (thêm)` : header) : fallback;
        // The first triple is the HĐLĐ "lương vị trí" in the LƯƠNG sheet; the rest is performance.
        add.qtyRate(metric, label, metric, num(ws, `${qtyCol}${r}`), num(ws, `${rateCol}${r}`), i === 0 ? 'position' : 'performance');
      });
      appendedColumns(ws, r, add, { headerRow: 5, other: 'AT', carry: { col: 'AU', net: 'AS' }, bonus: 'AV' });
    },
  },
  {
    sheet: 'LƯƠNG NGƯỜI MẪU',
    team: 'Mẫu',
    firstRow: 9,
    header: { H7: 'Số ngày quay', I7: 'Đơn giá' },
    expected: ['J', 'K', 'M'],
    parse(ws, r, add) {
      add.qtyRate('ngay-quay', 'Ngày quay', 'shootDays', num(ws, `H${r}`), num(ws, `I${r}`), 'performance');
      // This sheet subtracts "bù trừ kỳ trước" (M = J - K - L); carryOver() reads that sign.
      add.entry.carryOver = carryOver(ws, r, 'L', 'M');
      appendedColumns(ws, r, add, { headerRow: 5, bonus: 'N', other: 'O' });
    },
  },
];

function headerMatches(ws: Sheet, header: Record<string, string>): string | null {
  for (const [addr, text] of Object.entries(header)) {
    if (!str(ws, addr).toLowerCase().startsWith(text.toLowerCase())) {
      return `${addr} phải là "${text}" nhưng đang là "${str(ws, addr)}"`;
    }
  }
  return null;
}

/**
 * The month-named sheet ("TNCN 10.26", "LƯƠNG T10.26") for this payroll month.
 * Workbooks are copied forward month to month, so older ones (e.g. "TNCN 12.25")
 * are often still in the file — never take the first match blindly.
 */
function findMonthSheet(wb: XLSX.WorkBook, prefix: string, month: string | null): Sheet | undefined {
  const names = wb.SheetNames.filter((n) => n.trim().toUpperCase().startsWith(prefix) && /\d{1,2}\.\d{2}$/.test(n.trim()));
  if (month) {
    const [yyyy, mm] = month.split('-');
    const yy = yyyy.slice(2);
    const exact = names.find((n) => n.trim().endsWith(`${mm}.${yy}`) || n.trim().endsWith(` ${Number(mm)}.${yy}`));
    if (exact) return wb.Sheets[exact];
  }
  return names.length ? wb.Sheets[names[names.length - 1]] : undefined;
}

type MasterRow = { fullName: string; taxCode: string; idNumber: string; position: string };

function readMaster(wb: XLSX.WorkBook, warnings: string[]): Map<string, MasterRow> {
  const master = new Map<string, MasterRow>();
  const ws = wb.Sheets['Thông tin lao động'];
  if (!ws) {
    warnings.push('Không thấy sheet "Thông tin lao động" — tên/MST lấy từ các sheet lương.');
    return master;
  }
  for (const r of dataRows(ws, 9)) {
    master.set(str(ws, `B${r}`).toUpperCase(), {
      fullName: str(ws, `C${r}`),
      taxCode: str(ws, `J${r}`),
      idNumber: str(ws, `K${r}`),
      position: str(ws, `N${r}`),
    });
  }
  return master;
}

/** Codes on the "LƯƠNG Txx.yy" sheet with "x" under Bảo hiểm → HĐLĐ, with their insurance base. */
function readInsured(wb: XLSX.WorkBook, month: string | null): Map<string, number> {
  const insured = new Map<string, number>();
  const ws = findMonthSheet(wb, 'LƯƠNG T', month);
  if (!ws) return insured;
  for (const r of dataRows(ws, 11)) {
    if (isX(ws, `E${r}`)) insured.set(str(ws, `B${r}`).toUpperCase(), num(ws, `F${r}`));
  }
  return insured;
}

function readDependents(wb: XLSX.WorkBook, month: string | null): Map<string, number> {
  const deps = new Map<string, number>();
  const ws = findMonthSheet(wb, 'TNCN ', month);
  if (!ws) return deps;
  for (const r of dataRows(ws, 11)) {
    const n = num(ws, `L${r}`);
    if (n > 0) deps.set(str(ws, `B${r}`).toUpperCase(), n);
  }
  return deps;
}

/**
 * Rows of the TNCN sheet whose "Thuế TNCN" cell (Q) has no formula were
 * set by hand — blank means "không khấu trừ" (e.g. note "trả ngoài" in R).
 */
function readPitOverrides(wb: XLSX.WorkBook, month: string | null): Map<string, { amount: number; note: string }> {
  const overrides = new Map<string, { amount: number; note: string }>();
  const ws = findMonthSheet(wb, 'TNCN ', month);
  if (!ws) return overrides;
  for (const r of dataRows(ws, 11)) {
    const code = str(ws, `B${r}`).toUpperCase();
    if (overrides.has(code) || formula(ws, `Q${r}`)) continue;
    overrides.set(code, { amount: num(ws, `Q${r}`), note: str(ws, `R${r}`) || 'Thuế TNCN nhập tay trong file Excel' });
  }
  return overrides;
}

/**
 * "Tạm ứng": column V of "LƯƠNG Txx.yy" (HĐLĐ) and G of "CTV Txx.yyyy".
 * Team sheets' net never subtracts it, so callers lower the expected net too.
 */
function readAdvances(wb: XLSX.WorkBook, month: string | null): Map<string, number> {
  const advances = new Map<string, number>();
  const salary = findMonthSheet(wb, 'LƯƠNG T', month);
  if (salary) {
    for (const r of dataRows(salary, 11)) advances.set(str(salary, `B${r}`).toUpperCase(), num(salary, `V${r}`));
  }
  const [yyyy, mm] = (month ?? '').split('-');
  const ctvName = wb.SheetNames.find((n) => {
    const m = n.trim().match(/^CTV T(\d{1,2})\.(\d{4})$/i);
    return m && (!month || (Number(m[1]) === Number(mm) && m[2] === yyyy));
  });
  const ctv = ctvName ? wb.Sheets[ctvName] : undefined;
  if (ctv) {
    for (const r of dataRows(ctv, 11)) {
      const code = str(ctv, `B${r}`).toUpperCase();
      if (!advances.get(code)) advances.set(code, num(ctv, `G${r}`));
    }
  }
  return advances;
}

export function parsePayrollWorkbook(buffer: Buffer | ArrayBuffer): ExcelPayrollImport {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  const warnings: string[] = [];
  const master = readMaster(wb, warnings);
  let month: string | null = null;
  for (const parser of PARSERS) month ??= monthFromSheet(wb.Sheets[parser.sheet]);
  const insured = readInsured(wb, month);
  const dependents = readDependents(wb, month);
  const pitOverrides = readPitOverrides(wb, month);
  const advances = readAdvances(wb, month);

  const collected = new Map<string, Collected>();

  for (const parser of PARSERS) {
    const ws = wb.Sheets[parser.sheet];
    if (!ws) {
      warnings.push(`Không thấy sheet "${parser.sheet}".`);
      continue;
    }
    const mismatch = headerMatches(ws, parser.header);
    if (mismatch) {
      warnings.push(`Bỏ qua sheet "${parser.sheet}": bố cục cột đã đổi (${mismatch}).`);
      continue;
    }

    for (const r of dataRows(ws, parser.firstRow)) {
      const code = str(ws, `B${r}`).toUpperCase();
      const add = new Adder(code);
      parser.parse(ws, r, add);
      const [gCol, tCol, nCol] = parser.expected;
      const expected = { gross: num(ws, `${gCol}${r}`), tax: num(ws, `${tCol}${r}`), net: num(ws, `${nCol}${r}`), sheet: parser.sheet };
      const team = typeof parser.team === 'function' ? parser.team(ws, r) : parser.team;

      const existing = collected.get(code);
      if (existing) {
        warnings.push(`${code} xuất hiện ở cả "${existing.expected.sheet}" và "${parser.sheet}" — gộp công thức hai sheet.`);
        existing.components.push(...add.components.map((c) => ({ ...c, id: `${c.id}-2` })));
        for (const [k, v] of Object.entries(add.entry.metrics)) existing.entry.metrics[k] = (existing.entry.metrics[k] ?? 0) + v;
        existing.entry.bonus += add.entry.bonus;
        existing.entry.carryOver += add.entry.carryOver;
        continue;
      }
      collected.set(code, {
        code,
        team,
        fullName: str(ws, `C${r}`),
        position: str(ws, `D${r}`),
        hdld: isX(ws, `E${r}`),
        payNote: str(ws, `G${r}`) || str(ws, `F${r}`),
        components: add.components,
        entry: add.entry,
        expected,
      });
    }
  }

  const employees: PayrollEmployee[] = [];
  const entries: PayrollEntry[] = [];
  const expected: Record<string, ExcelExpected> = {};

  for (const c of collected.values()) {
    const m = master.get(c.code);
    const hdld = c.hdld || insured.has(c.code);
    const contractType: ContractType = hdld ? 'hdld' : 'ctv';
    if (hdld && !insured.has(c.code)) warnings.push(`${c.code}: có "x" ký HĐLĐ nhưng không thấy mức đóng bảo hiểm ở sheet LƯƠNG Txx.`);
    employees.push({
      code: c.code,
      fullName: m?.fullName || c.fullName,
      team: c.team,
      position: m?.position || c.position,
      contractType,
      insuranceBase: insured.get(c.code) ?? 0,
      taxCode: m?.taxCode ?? '',
      idNumber: m?.idNumber ?? '',
      dependents: dependents.get(c.code) ?? 0,
      username: '',
      payNote: /^\d+$/.test(c.payNote) ? '' : c.payNote,
      components: c.components,
      isActive: true,
    });
    const advance = advances.get(c.code) ?? 0;
    if (advance) {
      c.entry.advance = advance;
      c.expected.net -= advance;
    }
    const override = pitOverrides.get(c.code);
    if (override) {
      c.entry.pitOverride = override.amount;
      c.entry.note = c.entry.note ? `${c.entry.note}; ${override.note}` : override.note;
      warnings.push(`${c.code} ${c.fullName}: thuế TNCN nhập tay ${override.amount.toLocaleString('vi-VN')}đ (${override.note}).`);
    }
    entries.push(c.entry);
    expected[c.code] = c.expected;
  }

  // People in the master list who are on no team sheet this month: keep them, inactive.
  for (const [code, m] of master) {
    if (collected.has(code)) continue;
    employees.push({
      code,
      fullName: m.fullName,
      team: '',
      position: m.position,
      contractType: insured.has(code) ? 'hdld' : 'ctv',
      insuranceBase: insured.get(code) ?? 0,
      taxCode: m.taxCode,
      idNumber: m.idNumber,
      dependents: dependents.get(code) ?? 0,
      username: '',
      payNote: '',
      components: [],
      isActive: false,
    });
  }

  if (!month) warnings.push('Không xác định được tháng lương (ô A3 "Tháng MM/YYYY" ở các sheet team).');
  return { month, employees, entries, expected, warnings };
}
