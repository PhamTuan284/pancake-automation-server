import ExcelJS from 'exceljs';
import {
  componentMetrics,
  metricLabel,
  type PayComponent,
  type PayrollEmployee,
  type PayrollEntry,
  type PayrollSettings,
  type Payslip,
} from './payroll.types';

/**
 * Builds the month's payroll workbook in the same shape as the hand-made
 * "BẢNG LƯƠNG_MMYYYY.xlsx": same sheet names, same column letters and live
 * formulas (team sheets → TNCN → LƯƠNG Txx / CTV → TH LƯƠNG), so the
 * accountant can keep working in Excel and the importer can read it back.
 *
 * Each formula cell also carries the app's computed result, so the file shows
 * numbers before Excel recalculates; `fullCalcOnLoad` makes Excel recompute on
 * open. Components that don't fit a team sheet's fixed layout land in an
 * appended "Khoản khác (ngoài mẫu)" column so totals still match.
 */

export type WorkbookRow = { employee: PayrollEmployee; entry: PayrollEntry; payslip: Payslip };

export type WorkbookInput = {
  month: string; // YYYY-MM
  settings: PayrollSettings;
  rows: WorkbookRow[];
  /** Gross per team for the previous month, for "SS LƯƠNG". */
  previous?: { month: string; grossByTeam: Record<string, number> };
  companyName?: string;
};

// ---- cell helpers ----

const FONT: Partial<ExcelJS.Font> = { name: 'Times New Roman', size: 10 };
const THIN: Partial<ExcelJS.Border> = { style: 'thin' };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const HEADER_FILL = fill('FFD9D9D9');
const TOTAL_FILL = fill('FFE2EFDA');
const NET_FILL = fill('FFFFF2CC');
const MONEY = '#,##0';

export function colNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** VLOOKUP column index for a range starting at column B. */
const vIdx = (col: string) => colNum(col) - colNum('B') + 1;

type Num = number;
type CellOpts = { money?: boolean; bold?: boolean; fill?: ExcelJS.Fill; wrap?: boolean; align?: 'left' | 'center' | 'right' };

/** Thin wrapper over a worksheet that styles every cell it writes and remembers numeric results per row. */
class Sheet {
  /** row → column → numeric value written (input or formula result) */
  readonly values = new Map<number, Map<string, number>>();
  readonly rowOfCode = new Map<string, number>();
  constructor(readonly ws: ExcelJS.Worksheet) {}

  private style(cell: ExcelJS.Cell, o: CellOpts) {
    cell.font = { ...FONT, bold: Boolean(o.bold) };
    cell.border = BORDER;
    cell.alignment = { vertical: 'middle', wrapText: o.wrap ?? false, horizontal: o.align };
    if (o.money) cell.numFmt = MONEY;
    if (o.fill) cell.fill = o.fill;
  }

  private remember(addr: string, value: number) {
    const cell = this.ws.getCell(addr);
    const row = Number(cell.row);
    const col = addr.replace(/\d+$/, '');
    if (!this.values.has(row)) this.values.set(row, new Map());
    this.values.get(row)!.set(col, value);
  }

  get(row: number, col: string): number {
    return this.values.get(row)?.get(col) ?? 0;
  }

  /** Input value. Zero numbers are left blank, like the hand-made sheets. */
  v(addr: string, value: string | number | null | undefined, o: CellOpts = {}) {
    const cell = this.ws.getCell(addr);
    if (typeof value === 'number') {
      this.remember(addr, value);
      cell.value = value === 0 ? null : value;
    } else {
      cell.value = value ?? null;
    }
    this.style(cell, { money: typeof value === 'number', ...o });
  }

  f(addr: string, formula: string, result: Num | string, o: CellOpts = {}) {
    const cell = this.ws.getCell(addr);
    cell.value = { formula, result } as ExcelJS.CellFormulaValue;
    if (typeof result === 'number') this.remember(addr, result);
    this.style(cell, { money: typeof result === 'number', ...o });
  }

  header(addr: string, text: string, mergeTo?: string) {
    if (mergeTo && mergeTo !== addr) this.ws.mergeCells(`${addr}:${mergeTo}`);
    const cell = this.ws.getCell(addr);
    cell.value = text;
    cell.font = { ...FONT, bold: true };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if (mergeTo) {
      // Border every cell of the merged block so the grid stays closed.
      const [c1, r1] = [colNum(addr.replace(/\d+/, '')), Number(addr.replace(/\D+/, ''))];
      const [c2, r2] = [colNum(mergeTo.replace(/\d+/, '')), Number(mergeTo.replace(/\D+/, ''))];
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const m = this.ws.getCell(`${colLetter(c)}${r}`);
        m.border = BORDER;
        m.fill = HEADER_FILL;
      }
    }
  }

  title(text: string, sub: string, lastCol: string) {
    this.ws.mergeCells(`A2:${lastCol}2`);
    this.ws.mergeCells(`A3:${lastCol}3`);
    const t = this.ws.getCell('A2');
    t.value = text;
    t.font = { ...FONT, size: 15, bold: true };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    const s = this.ws.getCell('A3');
    s.value = sub;
    s.font = { ...FONT, size: 12, bold: true };
    s.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  /** "Tổng" row: SUM of every numeric column between `fromCol` and `toCol`. */
  totals(row: number, firstRow: number, lastRow: number, fromCol: string, toCol: string, labelCol = 'B', skip: string[] = []) {
    this.v(`${labelCol}${row}`, 'Tổng', { bold: true, fill: TOTAL_FILL, align: 'center' });
    for (let c = colNum(fromCol); c <= colNum(toCol); c++) {
      const col = colLetter(c);
      if (skip.includes(col)) continue;
      let sum = 0;
      let numeric = false;
      for (let r = firstRow; r <= lastRow; r++) {
        if (this.values.get(r)?.has(col)) {
          numeric = true;
          sum += this.get(r, col);
        }
      }
      if (!numeric) {
        this.v(`${col}${row}`, null, { fill: TOTAL_FILL });
        continue;
      }
      this.f(`${col}${row}`, lastRow >= firstRow ? `SUM(${col}${firstRow}:${col}${lastRow})` : '0', sum, { bold: true, fill: TOTAL_FILL });
    }
    for (let c = 1; c < colNum(fromCol); c++) {
      const col = colLetter(c);
      if (col !== labelCol) this.v(`${col}${row}`, null, { fill: TOTAL_FILL });
    }
  }

  /** Sets these widths, then widens any numeric column whose largest number would show as "#####". */
  widths(widths: Record<string, number>) {
    for (const [col, w] of Object.entries(widths)) this.ws.getColumn(col).width = w;
    const longest = new Map<string, number>();
    for (const row of this.values.values()) {
      for (const [col, v] of row) {
        const len = Math.round(v).toLocaleString('en-US').length + 3;
        longest.set(col, Math.max(longest.get(col) ?? 0, len));
      }
    }
    for (const [col, len] of longest) {
      const column = this.ws.getColumn(col);
      if ((column.width ?? 9) < len) column.width = len;
    }
  }
}

function monthParts(month: string) {
  const [yyyy, mm] = month.split('-');
  return { yyyy, mm, yy: yyyy.slice(2), m: Number(mm) };
}

export function sheetNames(month: string) {
  const { yyyy, mm, yy } = monthParts(month);
  return { salary: `LƯƠNG T${mm}.${yy}`, ctv: `CTV T${mm}.${yyyy}`, pit: `TNCN ${mm}.${yy}` };
}

function pctFormula(base: string, c: Extract<PayComponent, { kind: 'percent' }>): string {
  const factors = [`${+(c.pct * 100).toFixed(6)}%`];
  if (c.weight !== undefined && c.weight !== 1) factors.push(`${+(c.weight * 100).toFixed(6)}%`);
  const expr = `${base}*${factors.join('*')}`;
  return c.threshold ? `IF(${base}>${c.threshold},${expr},0)` : expr;
}

function pctValue(base: number, c: Extract<PayComponent, { kind: 'percent' }>): number {
  if (c.threshold && !(base > c.threshold)) return 0;
  return base * c.pct * (c.weight ?? 1);
}

/** Splits an employee's components into the ones a sheet layout claims and the leftovers. */
class Claims {
  private claimed = new Set<string>();
  constructor(private readonly row: WorkbookRow) {}

  take<K extends PayComponent['kind']>(kind: K, pred: (c: Extract<PayComponent, { kind: K }>) => boolean = () => true) {
    const c = this.row.employee.components.find(
      (x) => x.kind === kind && !this.claimed.has(x.id) && pred(x as Extract<PayComponent, { kind: K }>)
    ) as Extract<PayComponent, { kind: K }> | undefined;
    if (c) this.claimed.add(c.id);
    return c;
  }

  /** Every taxable fixed amount (exempt ones stay for "Khoản khác" so their exemption survives). */
  takeTaxableFixed() {
    const all = this.row.employee.components.filter(
      (x) => x.kind === 'fixed' && !x.taxExempt && !this.claimed.has(x.id)
    ) as Extract<PayComponent, { kind: 'fixed' }>[];
    for (const c of all) this.claimed.add(c.id);
    return all;
  }

  /** Amount (and tax-exempt part) of everything not claimed, from the engine's lines. */
  leftover(): { amount: number; exempt: number; labels: string[] } {
    const lines = this.row.payslip.lines.filter((l) => l.componentId !== 'bonus' && !this.claimed.has(l.componentId));
    return {
      amount: lines.reduce((s, l) => s + l.amount, 0),
      exempt: lines.filter((l) => l.taxExempt).reduce((s, l) => s + l.amount, 0),
      labels: [...new Set(lines.filter((l) => l.amount).map((l) => l.label))],
    };
  }
}

const m = (row: WorkbookRow, key: string) => row.entry.metrics[key] ?? 0;

/** Where a team sheet keeps the figures other sheets look up (for VLOOKUP from column B). */
type TeamLayout = {
  sheet: string;
  gross: string;
  exempt?: string;
  tax: string;
  net: string;
  groups: { position: string[]; performance: string[]; bonus: string[]; meal: string[]; ot: string[] };
};

type Ctx = { names: ReturnType<typeof sheetNames>; settings: PayrollSettings };

const taxLookup = (ctx: Ctx, r: number) => `VLOOKUP(B${r},'${ctx.names.pit}'!$B:$Q,16,0)`;
const bhLookup = (ctx: Ctx, r: number) => `VLOOKUP(B${r},'${ctx.names.salary}'!$B:$AB,12,0)`;

function commonCols(s: Sheet, r: number, i: number, row: WorkbookRow, position: string) {
  s.v(`A${r}`, i + 1, { align: 'center', money: false });
  s.v(`B${r}`, row.employee.code, { bold: true, align: 'center' });
  s.v(`C${r}`, row.employee.fullName);
  s.v(`D${r}`, position, { wrap: true });
  s.v(`E${r}`, row.employee.contractType === 'hdld' ? 'x' : null, { align: 'center' });
  s.v(`F${r}`, null);
  s.v(`G${r}`, row.employee.payNote || null, { wrap: true });
  s.rowOfCode.set(row.employee.code, r);
  s.ws.getRow(r).height = 30;
}

function netCarry(s: Sheet, r: number, carryCol: string, netCol: string, base: string, baseValue: number, carry: number) {
  s.v(`${carryCol}${r}`, Math.abs(carry));
  s.f(`${netCol}${r}`, `${base}${carry < 0 ? '-' : '+'}${carryCol}${r}`, baseValue + carry, { bold: true, fill: NET_FILL });
}

function otherNote(s: Sheet, addr: string, labels: string[]) {
  if (labels.length) s.ws.getCell(addr).note = `Gồm: ${labels.join(', ')}`;
}

// ---- team sheets ----

function liveSheet(s: Sheet, rows: WorkbookRow[], ctx: Ctx, monthText: string): TeamLayout {
  const L = ctx.settings.live;
  s.title('BẢNG TỔNG HỢP LƯƠNG TEAM LIVESTREAM', monthText, 'AW');
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Vị trí công việc', E: 'Ký hợp đồng LĐ', F: 'Cách tính lương cũ', G: 'Cách tính lương', W: 'Tổng lương livestream', AD: 'Tổng lương quay video', AN: 'Tổng lương năng suất', AO: 'Thưởng sáng kiến', AP: 'Tổng thu nhập', AQ: 'Thu nhập miễn thuế', AR: 'Thuế TNCN', AS: 'Bảo hiểm', AT: 'Thu nhập thực nhận', AU: 'Bù trừ kỳ trước', AV: 'Thực nhận', AW: 'Khoản khác (ngoài mẫu)' })) {
    s.header(`${c}5`, t, `${c}7`);
  }
  const groups: [string, string, string, string, string, string][] = [
    ['H', 'J', 'Lương livestream tiêu chuẩn', 'Số giờ live tiêu chuẩn', 'Đơn giá', 'Thành tiền'],
    ['K', 'M', 'Lương livestream ban ngày', 'Số giờ live', 'Đơn giá', 'Thành tiền'],
    ['N', 'P', 'Lương livestream ngày lễ', 'Số giờ live', `Đơn giá ×${L.holidayMultiplier}`, 'Thành tiền'],
    ['Q', 'S', 'Thưởng live vào chủ nhật', 'Số giờ live chủ nhật', `Đơn giá thưởng ${+(L.sundayBonusPct * 100).toFixed(2)}%`, 'Thành tiền'],
    ['T', 'V', 'Livestream ban đêm', 'Số giờ live đăng ký thêm (ca đêm quá 2h)', `Đơn giá ×${L.nightMultiplier}`, 'Thành tiền'],
  ];
  for (const [from, to, g, a, b, c] of groups) {
    s.header(`${from}5`, g, `${to}6`);
    const n = colNum(from);
    s.header(`${colLetter(n)}7`, a);
    s.header(`${colLetter(n + 1)}7`, b);
    s.header(`${colLetter(n + 2)}7`, c);
  }
  s.header('X5', 'Lương quay video', 'AC5');
  s.header('X6', 'Video tiêu chuẩn', 'Z6');
  s.header('AA6', 'Video OT', 'AC6');
  for (const [c, t] of Object.entries({ X: 'Số video', Y: 'Đơn giá', Z: 'Thành tiền', AA: 'Số video', AB: 'Đơn giá', AC: 'Thành tiền' })) s.header(`${c}7`, t);
  s.header('AE5', 'Lương % doanh thu', 'AM6');
  for (const [c, t] of Object.entries({ AE: 'Doanh thu live tiktok', AF: '% DT live TikTok', AG: 'Doanh thu live shopee', AH: '% DT live Shopee', AI: 'Doanh thu kênh video', AJ: '% DT kênh video', AK: 'Doanh thu live kênh riêng', AL: '% DT live kênh riêng', AM: 'Tổng' })) s.header(`${c}7`, t);

  const first = 9;
  rows.forEach((row, i) => {
    const r = first + i;
    commonCols(s, r, i, row, row.employee.position || 'Live');
    const cl = new Claims(row);
    const live = cl.take('live_hours');
    const rate = live?.rate ?? 0;
    const night = m(row, 'nightHours');
    const total = m(row, 'liveHours');
    const stdHours = live?.standardAmount && rate ? live.standardAmount / rate : 0;
    const H = live?.standardAmount ? stdHours : Math.max(0, total - night);
    const K = live?.standardAmount ? Math.max(0, total - stdHours - night) : 0;
    s.v(`H${r}`, H);
    s.v(`I${r}`, rate);
    s.f(`J${r}`, `H${r}*I${r}`, H * rate);
    s.v(`K${r}`, K);
    s.f(`L${r}`, `I${r}`, rate);
    s.f(`M${r}`, `K${r}*L${r}`, K * rate);
    const hol = m(row, 'holidayHours');
    s.v(`N${r}`, hol);
    s.f(`O${r}`, `I${r}*${L.holidayMultiplier}`, rate * L.holidayMultiplier);
    s.f(`P${r}`, `N${r}*O${r}`, hol * rate * L.holidayMultiplier);
    const sun = m(row, 'sundayHours');
    s.v(`Q${r}`, sun);
    s.f(`R${r}`, `I${r}*${L.sundayBonusPct}`, rate * L.sundayBonusPct);
    s.f(`S${r}`, `Q${r}*R${r}`, sun * rate * L.sundayBonusPct);
    s.v(`T${r}`, night);
    s.f(`U${r}`, `I${r}*${L.nightMultiplier}`, rate * L.nightMultiplier);
    s.f(`V${r}`, `T${r}*U${r}`, night * rate * L.nightMultiplier);
    const W = s.get(r, 'J') + s.get(r, 'V') + s.get(r, 'M') + s.get(r, 'S') + s.get(r, 'P');
    s.f(`W${r}`, `J${r}+V${r}+M${r}+S${r}+P${r}`, W, { bold: true });

    const video = cl.take('qty_rate', (c) => c.metric === 'videos' && !c.max);
    const videoOt = cl.take('qty_rate', (c) => c.metric === 'videosOT' && !c.max);
    s.v(`X${r}`, m(row, 'videos'));
    s.v(`Y${r}`, video?.rate ?? 0);
    s.f(`Z${r}`, `X${r}*Y${r}`, m(row, 'videos') * (video?.rate ?? 0));
    s.v(`AA${r}`, m(row, 'videosOT'));
    s.v(`AB${r}`, videoOt?.rate ?? 0);
    s.f(`AC${r}`, `AA${r}*AB${r}`, m(row, 'videosOT') * (videoOt?.rate ?? 0));
    s.f(`AD${r}`, `Z${r}+AC${r}`, s.get(r, 'Z') + s.get(r, 'AC'), { bold: true });

    const slots: [string, string, string][] = [
      ['AE', 'AF', 'revenueTiktokLive'],
      ['AG', 'AH', 'revenueShopeeLive'],
      ['AI', 'AJ', 'revenueVideoChannel'],
      ['AK', 'AL', 'revenueLiveChannel'],
    ];
    for (const [baseCol, amtCol, metric] of slots) {
      const c = cl.take('percent', (x) => x.metric === metric);
      const base = m(row, metric);
      s.v(`${baseCol}${r}`, base);
      if (c) s.f(`${amtCol}${r}`, pctFormula(`${baseCol}${r}`, c), pctValue(base, c));
      else s.v(`${amtCol}${r}`, 0);
    }
    const AM = ['AF', 'AH', 'AJ', 'AL'].reduce((a, c) => a + s.get(r, c), 0);
    s.f(`AM${r}`, `AF${r}+AH${r}+AJ${r}+AL${r}`, AM);
    const AN = ['M', 'S', 'V', 'Z', 'AC', 'AM', 'P'].reduce((a, c) => a + s.get(r, c), 0);
    s.f(`AN${r}`, `M${r}+S${r}+V${r}+Z${r}+AC${r}+AM${r}+P${r}`, AN);
    s.v(`AO${r}`, row.entry.bonus);
    const other = cl.leftover();
    s.v(`AW${r}`, other.amount);
    otherNote(s, `AW${r}`, other.labels);
    const AP = W + s.get(r, 'AD') + AM + row.entry.bonus + other.amount;
    s.f(`AP${r}`, `W${r}+AD${r}+AM${r}+AO${r}+AW${r}`, AP, { bold: true });
    s.f(`AQ${r}`, `V${r}+P${r}${other.exempt ? `+${other.exempt}` : ''}`, s.get(r, 'V') + s.get(r, 'P') + other.exempt);
    s.f(`AR${r}`, taxLookup(ctx, r), row.payslip.pit.amount);
    if (row.employee.contractType === 'hdld') s.f(`AS${r}`, bhLookup(ctx, r), row.payslip.insuranceEmployee.total);
    else s.v(`AS${r}`, 0);
    const AT = AP - row.payslip.pit.amount - s.get(r, 'AS');
    s.f(`AT${r}`, `AP${r}-AR${r}-AS${r}`, AT);
    netCarry(s, r, 'AU', 'AV', `AT${r}`, AT, row.entry.carryOver);
  });
  const last = first + rows.length - 1;
  s.totals(last + 1, first, last, 'H', 'AW', 'B', ['I', 'L', 'O', 'R', 'U', 'Y', 'AB']);
  s.widths({ A: 5, B: 10, C: 22, D: 14, E: 8, F: 6, G: 30, AP: 14, AV: 14, AW: 14 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 8 }];
  return {
    sheet: s.ws.name,
    gross: 'AP',
    exempt: 'AQ',
    tax: 'AR',
    net: 'AV',
    groups: { position: ['J'], performance: ['AN', 'AW'], bonus: ['AO'], meal: [], ot: [] },
  };
}

/** Sale and Kho–Kế toán share one shape (công × đơn giá, % doanh thu, OT, lễ, ăn ca). */
function officeSheet(
  s: Sheet,
  rows: WorkbookRow[],
  ctx: Ctx,
  monthText: string,
  kind: 'sale' | 'kho'
): TeamLayout {
  const sale = kind === 'sale';
  s.title(sale ? 'TỔNG HỢP LƯƠNG TEAM SALE' : 'TỔNG HỢP LƯƠNG KHO - KẾ TOÁN', monthText, 'AD');
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Vị trí công việc', E: 'Ký hợp đồng', F: 'Cách tính lương cũ', G: 'Cách tính lương' })) {
    s.header(`${c}5`, t, `${c}7`);
  }
  s.header('H5', 'Lương cơ bản/Phí cố định của CTV', 'J5');
  s.header('H6', 'Số công', 'H7');
  s.header('I6', 'Đơn giá', 'I7');
  s.header('J6', 'Thành tiền', 'J7');
  // Column letters differ between the two sheets; map them once.
  const C = sale
    ? { rev: 'K', pct: 'L', otH: 'M', otR: 'N', otA: 'O', hoH: 'P', hoR: 'Q', hoA: 'R', otT: 'S', perf: 'T', meal: 'U' }
    : { rev: 'L', pct: 'M', otH: 'N', otR: 'O', otA: 'P', hoH: 'Q', hoR: 'R', hoA: 'S', otT: 'T', perf: 'U', meal: 'K' };
  if (sale) {
    s.header('K5', 'Lương năng suất', 'S5');
    s.header('K6', 'Doanh thu FB', 'K7');
    s.header('L6', 'Thưởng doanh thu', 'L7');
    s.header('T5', 'Tổng lương năng suất', 'T7');
    s.header('U5', 'Tiền ăn ca', 'U7');
  } else {
    s.header('K5', 'Tiền ăn ca', 'K7');
    s.header('L5', 'Lương năng suất', 'T5');
    s.header('L6', 'Doanh thu tổng (sàn)', 'L7');
    s.header('M6', 'Thưởng doanh số', 'M7');
    s.header('U5', 'Tổng lương năng suất', 'U7');
  }
  s.header(`${C.otH}6`, 'Lương OT', `${C.otA}6`);
  s.header(`${C.otH}7`, 'Số giờ');
  s.header(`${C.otR}7`, 'Đơn giá');
  s.header(`${C.otA}7`, 'Thành tiền');
  s.header(`${C.hoH}6`, 'Lương ngày lễ', `${C.hoA}6`);
  s.header(`${C.hoH}7`, 'Số giờ');
  s.header(`${C.hoR}7`, 'Đơn giá');
  s.header(`${C.hoA}7`, 'Thành tiền');
  s.header(`${C.otT}6`, 'Tổng lương OT', `${C.otT}7`);
  for (const [c, t] of Object.entries({ V: 'Tổng thu nhập', W: 'TN miễn thuế', X: 'Thuế TNCN', Y: 'BHXH', Z: 'Thu nhập sau trừ thuế', AA: 'Bù trừ kỳ trước', AB: 'Tổng thực lĩnh', AC: 'Khoản khác (ngoài mẫu)', AD: 'Thưởng' })) {
    s.header(`${c}5`, t, `${c}7`);
  }

  const revenueMetric = sale ? 'revenueFB' : 'revenueCompany';
  const first = 9;
  rows.forEach((row, i) => {
    const r = first + i;
    const position = row.employee.team === 'Kế toán' && !/kế toán/i.test(row.employee.position)
      ? `Kế toán${row.employee.position ? ` – ${row.employee.position}` : ''}`
      : row.employee.position || row.employee.team;
    commonCols(s, r, i, row, position);
    const cl = new Claims(row);
    const days = m(row, 'workDays');
    s.v(`H${r}`, days);
    const cong = cl.take('qty_rate', (c) => c.metric === 'workDays' && c.group === 'position');
    if (cong) {
      s.v(`I${r}`, cong.rate);
      const raw = days * cong.rate;
      if (cong.max) s.f(`J${r}`, `MIN(H${r}*I${r},${cong.max})`, Math.min(raw, cong.max));
      else s.f(`J${r}`, `H${r}*I${r}`, raw);
    } else {
      const fixed = cl.takeTaxableFixed();
      s.v(`I${r}`, 0);
      s.v(`J${r}`, fixed.reduce((a, c) => a + c.amount, 0));
    }
    const pc = cl.take('percent', (c) => c.metric === revenueMetric);
    const rev = m(row, revenueMetric);
    s.v(`${C.rev}${r}`, rev);
    if (pc) s.f(`${C.pct}${r}`, pctFormula(`${C.rev}${r}`, pc), pctValue(rev, pc));
    else s.v(`${C.pct}${r}`, 0);
    const ot = cl.take('qty_rate', (c) => c.metric === 'otHours' && !c.max && c.rate >= 1000);
    s.v(`${C.otH}${r}`, m(row, 'otHours'));
    s.v(`${C.otR}${r}`, ot?.rate ?? 0);
    s.f(`${C.otA}${r}`, `${C.otH}${r}*${C.otR}${r}`, m(row, 'otHours') * (ot?.rate ?? 0));
    const ho = cl.take('qty_rate', (c) => c.metric === 'holidayOtHours' && !c.max);
    s.v(`${C.hoH}${r}`, m(row, 'holidayOtHours'));
    s.v(`${C.hoR}${r}`, ho?.rate ?? 0);
    s.f(`${C.hoA}${r}`, `${C.hoH}${r}*${C.hoR}${r}`, m(row, 'holidayOtHours') * (ho?.rate ?? 0));
    const otTotal = s.get(r, C.otA) + s.get(r, C.hoA);
    s.f(`${C.otT}${r}`, `${C.otA}${r}+${C.hoA}${r}`, otTotal);
    const perf = s.get(r, C.pct) + otTotal;
    s.f(`${C.perf}${r}`, `${C.pct}${r}+${C.otA}${r}+${C.hoA}${r}`, perf);
    const meal = cl.take('qty_rate', (c) => c.metric === 'workDays' && c.group === 'meal' && !c.max);
    if (meal) s.f(`${C.meal}${r}`, `H${r}*${meal.rate}`, days * meal.rate);
    else s.v(`${C.meal}${r}`, 0);
    const other = cl.leftover();
    s.v(`AC${r}`, other.amount);
    otherNote(s, `AC${r}`, other.labels);
    s.v(`AD${r}`, row.entry.bonus);
    const V = s.get(r, 'J') + perf + s.get(r, C.meal) + other.amount + row.entry.bonus;
    s.f(`V${r}`, `J${r}+${C.perf}${r}+${C.meal}${r}+AC${r}+AD${r}`, V, { bold: true });
    // Exempt like the workbook: OT/lễ when that component is exempt, plus ăn ca.
    const exemptParts = [
      ...(ot?.taxExempt ? [`${C.otA}${r}`] : []),
      ...(ho?.taxExempt ? [`${C.hoA}${r}`] : []),
      ...(meal?.taxExempt ? [`${C.meal}${r}`] : []),
    ];
    const exemptValue = exemptParts.reduce((a, addr) => a + s.get(r, addr.replace(/\d+$/, '')), 0) + other.exempt;
    s.f(`W${r}`, `${exemptParts.join('+') || '0'}${other.exempt ? `+${other.exempt}` : ''}`, exemptValue);
    s.f(`X${r}`, taxLookup(ctx, r), row.payslip.pit.amount);
    if (row.employee.contractType === 'hdld') s.f(`Y${r}`, bhLookup(ctx, r), row.payslip.insuranceEmployee.total);
    else s.v(`Y${r}`, 0);
    const Z = V - row.payslip.pit.amount - s.get(r, 'Y');
    s.f(`Z${r}`, `V${r}-X${r}-Y${r}`, Z);
    netCarry(s, r, 'AA', 'AB', `Z${r}`, Z, row.entry.carryOver);
  });
  const last = first + rows.length - 1;
  s.totals(last + 1, first, last, 'H', 'AD', 'B', ['I', C.otR, C.hoR]);
  s.widths({ A: 5, B: 10, C: 22, D: 16, E: 8, F: 6, G: 30, V: 14, AB: 14, AC: 14 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 8 }];
  return {
    sheet: s.ws.name,
    gross: 'V',
    exempt: 'W',
    tax: 'X',
    net: 'AB',
    groups: { position: ['J'], performance: [C.pct, 'AC'], bonus: ['AD'], meal: [C.meal], ot: [C.otT] },
  };
}

const MARKETING_SLOTS: [string, string, string, string, string][] = [
  ['H', 'I', 'revenueFB', 'Doanh thu FB', '% doanh thu FB'],
  ['J', 'K', 'revenueShopee', 'Doanh thu shopee', '% doanh thu shopee'],
  ['L', 'M', 'revenueTiktok', 'Doanh thu kết chuyển tiktok', '% doanh thu kết chuyển tiktok'],
];

function marketingSheet(s: Sheet, rows: WorkbookRow[], ctx: Ctx, monthText: string): TeamLayout {
  s.title('TỔNG HỢP LƯƠNG TEAM MARKETING', monthText, 'U');
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Vị trí công việc', E: 'Ký hợp đồng', F: 'Cách tính lương cũ', G: 'Cách tính lương' })) {
    s.header(`${c}5`, t, `${c}6`);
  }
  s.header('H5', 'Thu nhập chi trả', 'O5');
  // The importer checks these row-6 headers, so they are not merged upward.
  for (const [rev, pct, , revLabel, pctLabel] of MARKETING_SLOTS) {
    s.header(`${rev}6`, revLabel);
    s.header(`${pct}6`, pctLabel);
  }
  for (const [c, t] of Object.entries({ N: 'Phí dịch vụ cố định', O: 'Bổ sung', P: 'Tổng lương', Q: 'Thuế TNCN', R: 'Bù trừ kỳ trước', S: 'Số thực nhận', T: 'Khoản khác (ngoài mẫu)', U: 'BHXH' })) {
    s.header(`${c}6`, t);
    if (!['N', 'O'].includes(c)) s.header(`${c}5`, '');
  }
  const first = 8;
  rows.forEach((row, i) => {
    const r = first + i;
    commonCols(s, r, i, row, row.employee.position || row.employee.team || '(chưa xếp team)');
    const cl = new Claims(row);
    for (const [rev, pct, metric] of MARKETING_SLOTS) {
      const c = cl.take('percent', (x) => x.metric === metric);
      const base = m(row, metric);
      s.v(`${rev}${r}`, base);
      if (c) s.f(`${pct}${r}`, pctFormula(`${rev}${r}`, c), pctValue(base, c));
      else s.v(`${pct}${r}`, 0);
    }
    const fixed = cl.takeTaxableFixed();
    s.v(`N${r}`, fixed.reduce((a, c) => a + c.amount, 0));
    s.v(`O${r}`, row.entry.bonus);
    const other = cl.leftover();
    s.v(`T${r}`, other.amount);
    otherNote(s, `T${r}`, other.labels);
    const P = ['I', 'K', 'M', 'N', 'O', 'T'].reduce((a, c) => a + s.get(r, c), 0);
    s.f(`P${r}`, `I${r}+K${r}+M${r}+N${r}+O${r}+T${r}`, P, { bold: true });
    s.f(`Q${r}`, taxLookup(ctx, r), row.payslip.pit.amount);
    if (row.employee.contractType === 'hdld') s.f(`U${r}`, bhLookup(ctx, r), row.payslip.insuranceEmployee.total);
    else s.v(`U${r}`, 0);
    s.v(`R${r}`, row.entry.carryOver);
    s.f(`S${r}`, `P${r}-Q${r}-U${r}+R${r}`, P - row.payslip.pit.amount - s.get(r, 'U') + row.entry.carryOver, { bold: true, fill: NET_FILL });
  });
  const last = first + rows.length - 1;
  s.totals(last + 1, first, last, 'H', 'U');
  s.widths({ A: 5, B: 10, C: 22, D: 18, E: 8, F: 6, G: 30, P: 14, S: 14, T: 14 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 7 }];
  return {
    sheet: s.ws.name,
    gross: 'P',
    tax: 'Q',
    net: 'S',
    groups: { position: ['N'], performance: ['I', 'K', 'M', 'T'], bonus: ['O'], meal: [], ot: [] },
  };
}

const MEDIA_TRIPLES: [string, string, string, string, string][] = [
  ['G', 'H', 'I', 'mediaVideoFull', 'Vid cả quay + dựng'],
  ['J', 'K', 'L', 'mediaShootOrEdit', 'Chỉ quay/dựng/ Chụp look'],
  ['M', 'N', 'O', 'mediaScript', 'Kịch bản/banner'],
  ['P', 'Q', 'R', 'mediaOutdoorDays', 'Ngày quay outdoor'],
  ['T', 'U', 'V', 'mediaVideoOver', 'Vid cả quay + dựng'],
  ['W', 'X', 'Y', 'mediaShootOrEditExtra', 'Chỉ quay/dựng'],
  ['Z', 'AA', 'AB', 'mediaSatellite', 'Quay kênh vệ tinh'],
  ['AC', 'AD', 'AE', 'mediaScriptExtra', 'Kịch bản'],
  ['AF', 'AG', 'AH', 'mediaHolidayShoot', 'Quay ngày lễ'],
  ['AI', 'AJ', 'AK', 'mediaPhotoPost', 'Chụp - hậu kỳ'],
  ['AL', 'AM', 'AN', 'mediaPhotoEdit', 'Chụp/Hậu kỳ ảnh'],
];

function mediaSheet(s: Sheet, rows: WorkbookRow[], ctx: Ctx, monthText: string): TeamLayout {
  s.title('TỔNG HỢP LƯƠNG TEAM MEDIA', monthText, 'AV');
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Vị trí công việc', E: 'Ký hợp đồng', F: 'Cách tính lương', AO: 'Tổng thu nhập chi trả thêm', AP: 'Tổng thu nhập', AQ: 'Thuế TNCN', AR: 'BHXH', AS: 'Thực nhận', AT: 'Khoản khác (ngoài mẫu)', AU: 'Bù trừ kỳ trước', AV: 'Thưởng' })) {
    s.header(`${c}5`, t, `${c}8`);
  }
  s.header('G5', 'Thu nhập chi trả', 'S6');
  s.header('T5', 'Thu nhập chi trả thêm theo sản phẩm', 'AN6');
  for (const [q, rt, amt, , label] of MEDIA_TRIPLES) {
    s.header(`${q}7`, label, `${amt}7`);
    s.header(`${q}8`, q === 'P' || q === 'AF' || q === 'AI' || q === 'AL' ? 'Số lượng' : 'Số video');
    s.header(`${rt}8`, 'Đơn giá');
    s.header(`${amt}8`, 'Thành tiền');
  }
  s.header('S7', 'Tổng', 'S8');
  // G8 must read "Số video" for the importer's layout check.
  const first = 10;
  rows.forEach((row, i) => {
    const r = first + i;
    commonCols(s, r, i, row, row.employee.position || 'Media');
    s.v(`F${r}`, row.employee.payNote || null, { wrap: true });
    s.v(`G${r}`, null);
    const cl = new Claims(row);
    for (const [q, rt, amt, metric] of MEDIA_TRIPLES) {
      const c = cl.take('qty_rate', (x) => x.metric === metric && !x.max);
      const qty = m(row, metric);
      s.v(`${q}${r}`, qty);
      s.v(`${rt}${r}`, c?.rate ?? 0);
      s.f(`${amt}${r}`, `${q}${r}*${rt}${r}`, qty * (c?.rate ?? 0));
    }
    const S = ['I', 'L', 'O', 'R'].reduce((a, c) => a + s.get(r, c), 0);
    s.f(`S${r}`, `I${r}+L${r}+O${r}+R${r}`, S);
    const extraCols = ['V', 'Y', 'AB', 'AE', 'AH', 'AK', 'AN'];
    const AO = extraCols.reduce((a, c) => a + s.get(r, c), 0);
    s.f(`AO${r}`, extraCols.map((c) => `${c}${r}`).join('+'), AO);
    const other = cl.leftover();
    s.v(`AT${r}`, other.amount);
    otherNote(s, `AT${r}`, other.labels);
    s.v(`AV${r}`, row.entry.bonus);
    const AP = S + AO + other.amount + row.entry.bonus;
    s.f(`AP${r}`, `S${r}+AO${r}+AT${r}+AV${r}`, AP, { bold: true });
    s.f(`AQ${r}`, taxLookup(ctx, r), row.payslip.pit.amount);
    if (row.employee.contractType === 'hdld') s.f(`AR${r}`, bhLookup(ctx, r), row.payslip.insuranceEmployee.total);
    else s.v(`AR${r}`, 0);
    s.v(`AU${r}`, row.entry.carryOver);
    s.f(`AS${r}`, `AP${r}-AQ${r}-AR${r}+AU${r}`, AP - row.payslip.pit.amount - s.get(r, 'AR') + row.entry.carryOver, { bold: true, fill: NET_FILL });
  });
  const last = first + rows.length - 1;
  s.totals(last + 1, first, last, 'G', 'AV', 'B', MEDIA_TRIPLES.map(([, rt]) => rt));
  s.widths({ A: 5, B: 10, C: 22, D: 18, E: 8, F: 30, AP: 14, AS: 14, AT: 14 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 9 }];
  return {
    sheet: s.ws.name,
    gross: 'AP',
    tax: 'AQ',
    net: 'AS',
    groups: { position: ['I'], performance: ['L', 'O', 'R', 'AO', 'AT'], bonus: ['AV'], meal: [], ot: [] },
  };
}

function modelSheet(s: Sheet, rows: WorkbookRow[], ctx: Ctx, monthText: string): TeamLayout {
  s.title('TỔNG HỢP LƯƠNG NGƯỜI MẪU', monthText, 'P');
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Vị trí công việc', E: 'Ký hợp đồng', F: 'Cách tính lương', G: 'Cách chấm công', K: 'Thuế TNCN', L: 'Bù trừ kỳ trước', M: 'Thu nhập thực nhận', N: 'Thưởng', O: 'Khoản khác (ngoài mẫu)', P: 'BHXH' })) {
    s.header(`${c}5`, t, `${c}7`);
  }
  s.header('H5', 'Lương chi trả', 'J6');
  s.header('H7', 'Số ngày quay');
  s.header('I7', 'Đơn giá');
  s.header('J7', 'Thành tiền');
  const first = 9;
  rows.forEach((row, i) => {
    const r = first + i;
    commonCols(s, r, i, row, row.employee.position || 'Người mẫu');
    s.v(`F${r}`, row.employee.payNote || null, { wrap: true });
    s.v(`G${r}`, null);
    const cl = new Claims(row);
    const c = cl.take('qty_rate', (x) => x.metric === 'shootDays' && !x.max);
    const days = m(row, 'shootDays');
    s.v(`H${r}`, days);
    s.v(`I${r}`, c?.rate ?? 0);
    const other = cl.leftover();
    s.v(`N${r}`, row.entry.bonus);
    s.v(`O${r}`, other.amount);
    otherNote(s, `O${r}`, other.labels);
    const J = days * (c?.rate ?? 0) + row.entry.bonus + other.amount;
    s.f(`J${r}`, `H${r}*I${r}+N${r}+O${r}`, J, { bold: true });
    s.f(`K${r}`, taxLookup(ctx, r), row.payslip.pit.amount);
    if (row.employee.contractType === 'hdld') s.f(`P${r}`, bhLookup(ctx, r), row.payslip.insuranceEmployee.total);
    else s.v(`P${r}`, 0);
    // This sheet subtracts "bù trừ" (M = J - K - L), so a credit is written negative.
    s.v(`L${r}`, -row.entry.carryOver);
    s.f(`M${r}`, `J${r}-K${r}-L${r}-P${r}`, J - row.payslip.pit.amount + row.entry.carryOver - s.get(r, 'P'), { bold: true, fill: NET_FILL });
  });
  const last = first + rows.length - 1;
  s.totals(last + 1, first, last, 'H', 'P', 'B', ['I']);
  s.widths({ A: 5, B: 10, C: 22, D: 14, E: 8, F: 26, G: 14, J: 14, M: 14, O: 14 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 8 }];
  return {
    sheet: s.ws.name,
    gross: 'J',
    tax: 'K',
    net: 'M',
    groups: { position: [], performance: ['J'], bonus: [], meal: [], ot: [] },
  };
}

// ---- summary sheets ----

function lookupSum(layout: TeamLayout, cols: string[], r: number): string {
  if (!cols.length) return '0';
  return cols.map((c) => `VLOOKUP($B${r},'${layout.sheet}'!$B:$BA,${vIdx(c)},0)`).join('+');
}

type Placed = { row: WorkbookRow; layout: TeamLayout; teamSheet: Sheet };

function pitSheet(s: Sheet, placed: Placed[], ctx: Ctx, month: string): { totalRow: number; hdldTotalRow: number; ctvTotalRow: number } {
  const { m: mm, yyyy } = monthParts(month);
  const P = ctx.settings.pit;
  s.ws.mergeCells('A4:R4');
  s.ws.mergeCells('A5:R5');
  s.ws.getCell('A4').value = 'BẢNG TÍNH THUẾ TNCN';
  s.ws.getCell('A5').value = `Tháng ${mm} năm ${yyyy}`;
  for (const a of ['A4', 'A5']) {
    s.ws.getCell(a).font = { ...FONT, bold: true, size: 12 };
    s.ws.getCell(a).alignment = { horizontal: 'center' };
  }
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Mã số thuế', E: 'Ký hợp đồng', F: 'Tiền thưởng (ngoài bảng)', G: 'Tổng thu nhập', H: 'TN miễn thuế', I: 'Khoản trừ khác', J: 'Tổng thu nhập chịu thuế', P: 'Thu Nhập Tính Thuế', Q: 'Thuế TNCN', R: 'Ghi chú' })) {
    s.header(`${c}7`, t, `${c}9`);
  }
  s.header('K7', 'Các khoản giảm trừ', 'O7');
  s.header('K8', 'Bản thân', 'K9');
  s.header('L8', 'Người Phụ Thuộc', 'M8');
  s.header('L9', 'Số người');
  s.header('M9', 'Số giảm');
  s.header('N8', 'Bảo hiểm', 'N9');
  s.header('O8', 'Tổng Cộng', 'O9');

  // Progressive formula built from the configured brackets, same shape as the workbook's.
  const progressive = (p: string) => {
    let lower = 0;
    return P.brackets
      .map((b) => {
        const part = b.upTo === null ? `MAX(${p}-${lower},0)*${b.rate}` : `MAX(MIN(${p}-${lower},${b.upTo - lower}),0)*${b.rate}`;
        lower = b.upTo ?? lower;
        return part;
      })
      .join('+');
  };

  let r = 11;
  const section = (label: string, list: Placed[]): number => {
    s.v(`A${r}`, label, { bold: true });
    s.ws.mergeCells(`A${r}:R${r}`);
    r++;
    const firstRow = r;
    list.forEach(({ row, layout }, i) => {
      const e = row.employee;
      const hdld = e.contractType === 'hdld';
      s.v(`A${r}`, i + 1, { align: 'center', money: false });
      s.v(`B${r}`, e.code, { bold: true, align: 'center' });
      s.v(`C${r}`, e.fullName);
      s.v(`D${r}`, e.taxCode || null);
      s.v(`E${r}`, hdld ? 'x' : null, { align: 'center' });
      s.v(`F${r}`, 0);
      s.f(`G${r}`, `VLOOKUP(B${r},'${layout.sheet}'!$B:$${layout.gross},${vIdx(layout.gross)},0)`, row.payslip.gross);
      if (layout.exempt) s.f(`H${r}`, `VLOOKUP(B${r},'${layout.sheet}'!$B:$${layout.exempt},${vIdx(layout.exempt)},0)`, row.payslip.taxExempt);
      else s.v(`H${r}`, row.payslip.taxExempt);
      s.v(`I${r}`, 0);
      s.f(`J${r}`, `G${r}-H${r}+F${r}-I${r}`, row.payslip.taxableIncome);
      s.f(`K${r}`, `IF(E${r}="x",${P.personalDeduction},0)`, hdld ? P.personalDeduction : 0);
      s.v(`L${r}`, e.dependents);
      s.f(`M${r}`, `L${r}*${P.dependentDeduction}`, e.dependents * P.dependentDeduction);
      if (hdld) s.f(`N${r}`, `VLOOKUP(B${r},'${ctx.names.salary}'!$B:$AB,12,0)`, row.payslip.insuranceEmployee.total);
      else s.v(`N${r}`, 0);
      const O = s.get(r, 'K') + s.get(r, 'M') + s.get(r, 'N');
      s.f(`O${r}`, `K${r}+M${r}+N${r}`, O);
      s.f(`P${r}`, `MAX(J${r}-O${r},0)`, Math.max(row.payslip.taxableIncome - O, 0));
      if (row.payslip.pit.overridden) {
        // Hand-entered tax: a plain value (no formula) — the importer reads that as an override.
        s.v(`Q${r}`, row.payslip.pit.amount, { bold: true });
        s.v(`R${r}`, row.entry.note || 'Thuế nhập tay', { wrap: true });
      } else {
        s.f(
          `Q${r}`,
          `IF(E${r}="x",${progressive(`P${r}`)},IF(J${r}>=${P.ctvThreshold},J${r}*${P.ctvRate},0))`,
          row.payslip.pit.amount,
          { bold: true }
        );
        s.v(`R${r}`, null);
      }
      r++;
    });
    const lastRow = r - 1;
    s.totals(r, firstRow, lastRow, 'F', 'Q', 'A', ['L']);
    s.ws.getCell(`A${r}`).value = `Tổng ${label.replace(/^[IV]+\.\s*/, '').toLowerCase()}`;
    return r++;
  };
  const hdldTotalRow = section('I. Lao động chính thức', placed.filter((p) => p.row.employee.contractType === 'hdld'));
  const ctvTotalRow = section('II. Cộng tác viên', placed.filter((p) => p.row.employee.contractType !== 'hdld'));
  s.v(`A${r}`, 'TỔNG CỘNG', { bold: true, fill: TOTAL_FILL });
  for (const c of ['G', 'H', 'J', 'N', 'P', 'Q']) {
    s.f(`${c}${r}`, `${c}${hdldTotalRow}+${c}${ctvTotalRow}`, s.get(hdldTotalRow, c) + s.get(ctvTotalRow, c), { bold: true, fill: TOTAL_FILL });
  }
  s.widths({ A: 5, B: 10, C: 22, D: 13, E: 7, F: 10, G: 14, H: 12, I: 9, J: 14, K: 12, L: 7, M: 11, N: 11, O: 13, P: 14, Q: 13, R: 22 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 9 }];
  return { totalRow: r, hdldTotalRow, ctvTotalRow };
}

function salarySheet(s: Sheet, placed: Placed[], ctx: Ctx, month: string, companyName: string): { first: number; last: number; total: number } {
  const { m: mm, yyyy } = monthParts(month);
  const I = ctx.settings.insurance;
  s.ws.getCell('A1').value = companyName;
  s.ws.getCell('A1').font = { ...FONT, bold: true };
  s.ws.mergeCells('A4:AB4');
  s.ws.mergeCells('A5:AB5');
  s.ws.getCell('A4').value = 'BẢNG TÍNH LƯƠNG VÀ BẢO HIỂM';
  s.ws.getCell('A5').value = `Tháng ${mm} Năm ${yyyy}`;
  for (const a of ['A4', 'A5']) {
    s.ws.getCell(a).font = { ...FONT, bold: true, size: 12 };
    s.ws.getCell(a).alignment = { horizontal: 'center' };
  }
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Vị trí công việc', G: 'Lương vị trí', H: 'Lương hiệu quả công việc', I: 'Thưởng', J: 'Tiền ăn ca', K: 'Tiền OT/làm đêm', L: 'Tổng thu nhập', R: 'Thu nhập miễn thuế', S: 'Thu nhập chịu thuế', T: 'Thuế TNCN', U: 'Bù trừ kỳ trước', V: 'Tạm ứng', W: 'Thực lĩnh (chuyển khoản cho NLĐ)' })) {
    s.header(`${c}7`, t, `${c}9`);
  }
  s.header('E7', 'Bảo hiểm', 'F7');
  s.header('E8', 'Tham gia', 'E9');
  s.header('F8', 'Mức đóng', 'F9');
  s.header('M7', 'Bảo hiểm người lao động đóng', 'Q7');
  s.header('X7', 'Bảo hiểm công ty', 'AB7');
  const rateCols: [string, string, number][] = [
    ['N', 'BHXH', I.employee.bhxh], ['O', 'BHYT', I.employee.bhyt], ['P', 'BHTN', I.employee.bhtn], ['Q', 'Đoàn phí', I.employee.union],
    ['Y', 'BHXH', I.company.bhxh], ['Z', 'BHYT', I.company.bhyt], ['AA', 'BHTN', I.company.bhtn], ['AB', 'Công đoàn', I.company.union],
  ];
  s.header('M8', 'Tổng', 'M9');
  s.header('X8', 'Tổng', 'X9');
  for (const [c, t, rate] of rateCols) {
    s.header(`${c}8`, t);
    const cell = s.ws.getCell(`${c}9`);
    cell.value = rate;
    cell.numFmt = '0.0%';
    cell.font = { ...FONT, bold: true, color: { argb: 'FFFF0000' } };
    cell.border = BORDER;
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center' };
  }
  const first = 11;
  const hdld = placed.filter((p) => p.row.employee.contractType === 'hdld');
  hdld.forEach(({ row, layout }, i) => {
    const r = first + i;
    const p = row.payslip;
    s.v(`A${r}`, i + 1, { align: 'center', money: false });
    s.v(`B${r}`, row.employee.code, { bold: true, align: 'center' });
    s.v(`C${r}`, row.employee.fullName);
    s.v(`D${r}`, row.employee.team);
    s.v(`E${r}`, row.employee.insuranceBase > 0 ? 'x' : null, { align: 'center' });
    s.v(`F${r}`, row.employee.insuranceBase);
    const groupVal = (cols: string[]) => cols.reduce((a, c) => a + placedValue(layout, row, c), 0);
    s.f(`G${r}`, lookupSum(layout, layout.groups.position, r), groupVal(layout.groups.position));
    s.f(`H${r}`, lookupSum(layout, layout.groups.performance, r), groupVal(layout.groups.performance));
    s.f(`I${r}`, lookupSum(layout, layout.groups.bonus, r), groupVal(layout.groups.bonus));
    s.f(`J${r}`, lookupSum(layout, layout.groups.meal, r), groupVal(layout.groups.meal));
    s.f(`K${r}`, lookupSum(layout, layout.groups.ot, r), groupVal(layout.groups.ot));
    s.f(`L${r}`, `G${r}+H${r}+I${r}+J${r}+K${r}`, ['G', 'H', 'I', 'J', 'K'].reduce((a, c) => a + s.get(r, c), 0), { bold: true });
    s.f(`M${r}`, `SUM(N${r}:Q${r})`, p.insuranceEmployee.total);
    const ins: [string, number][] = [['N', p.insuranceEmployee.bhxh], ['O', p.insuranceEmployee.bhyt], ['P', p.insuranceEmployee.bhtn], ['Q', p.insuranceEmployee.union], ['Y', p.insuranceCompany.bhxh], ['Z', p.insuranceCompany.bhyt], ['AA', p.insuranceCompany.bhtn], ['AB', p.insuranceCompany.union]];
    for (const [c, v] of ins) s.f(`${c}${r}`, `IF($E${r}="x",ROUND($F${r}*${c}$9,0),0)`, v);
    s.f(`R${r}`, `VLOOKUP(B${r},'${ctx.names.pit}'!$B:$Q,7,0)`, p.taxExempt);
    s.f(`S${r}`, `L${r}-R${r}`, s.get(r, 'L') - p.taxExempt);
    s.f(`T${r}`, `VLOOKUP(B${r},'${ctx.names.pit}'!$B:$Q,16,0)`, p.pit.amount);
    s.v(`U${r}`, row.entry.carryOver);
    s.v(`V${r}`, row.entry.advance);
    s.f(`W${r}`, `L${r}-M${r}-T${r}+U${r}-V${r}`, s.get(r, 'L') - p.insuranceEmployee.total - p.pit.amount + row.entry.carryOver - row.entry.advance, { bold: true, fill: NET_FILL });
    s.f(`X${r}`, `SUM(Y${r}:AB${r})`, p.insuranceCompany.total);
  });
  const last = first + hdld.length - 1;
  const total = last + 1;
  s.totals(total, first, last, 'F', 'AB', 'A');
  s.ws.getCell(`A${total}`).value = 'TỔNG';
  s.widths({ A: 5, B: 9, C: 22, D: 10, E: 7, F: 11, W: 14 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 9 }];
  return { first, last, total };
}

/** Numeric result a team sheet holds for this employee in `col`. */
function placedValue(layout: TeamLayout, row: WorkbookRow, col: string): number {
  const sheet = sheetsByName.get(layout.sheet);
  const r = sheet?.rowOfCode.get(row.employee.code);
  return sheet && r ? sheet.get(r, col) : 0;
}

// Filled while building, so the summary sheets can read the team sheets' results.
const sheetsByName = new Map<string, Sheet>();

function ctvSheet(s: Sheet, placed: Placed[], month: string, ctx: Ctx, companyName: string): { teamTotals: Map<string, number>; total: number } {
  const { m: mm, yyyy } = monthParts(month);
  s.ws.getCell('A1').value = companyName;
  s.ws.getCell('A1').font = { ...FONT, bold: true };
  s.ws.mergeCells('A4:I4');
  s.ws.mergeCells('A5:I5');
  s.ws.getCell('A4').value = 'BẢNG TỔNG HỢP THU NHẬP CHI TRẢ CỘNG TÁC VIÊN';
  s.ws.getCell('A5').value = `Tháng ${mm}/${yyyy}`;
  for (const a of ['A4', 'A5']) {
    s.ws.getCell(a).font = { ...FONT, bold: true, size: 12 };
    s.ws.getCell(a).alignment = { horizontal: 'center' };
  }
  for (const [c, t] of Object.entries({ A: 'STT', B: 'Mã nhân viên', C: 'Họ và tên', D: 'Vị trí công việc', E: 'Tổng thu nhập chi trả', F: 'Thuế TNCN', G: 'Tạm ứng', H: 'Thực lĩnh', I: 'Bù trừ kỳ trước' })) {
    s.header(`${c}7`, t, `${c}9`);
  }
  const ctv = placed.filter((p) => p.row.employee.contractType !== 'hdld');
  const teams = [...new Set(ctv.map((p) => p.row.employee.team))];
  let r = 11;
  let stt = 0;
  const teamTotals = new Map<string, number>();
  for (const team of teams) {
    const firstRow = r;
    for (const { row, layout } of ctv.filter((p) => p.row.employee.team === team)) {
      const p = row.payslip;
      s.v(`A${r}`, ++stt, { align: 'center', money: false });
      s.v(`B${r}`, row.employee.code, { bold: true, align: 'center' });
      s.v(`C${r}`, row.employee.fullName);
      s.v(`D${r}`, team || '(chưa xếp team)');
      s.f(`E${r}`, `VLOOKUP(B${r},'${layout.sheet}'!$B:$${layout.gross},${vIdx(layout.gross)},0)`, p.gross);
      s.f(`F${r}`, `VLOOKUP(B${r},'${ctx.names.pit}'!$B:$Q,16,0)`, p.pit.amount);
      s.v(`G${r}`, row.entry.advance);
      s.v(`I${r}`, row.entry.carryOver);
      s.f(`H${r}`, `E${r}-F${r}-G${r}+I${r}`, p.gross - p.pit.amount - row.entry.advance + row.entry.carryOver, { bold: true, fill: NET_FILL });
      r++;
    }
    s.totals(r, firstRow, r - 1, 'E', 'I', 'A');
    s.ws.getCell(`A${r}`).value = `Tổng team ${team || '(chưa xếp team)'}`;
    teamTotals.set(team, r);
    r++;
  }
  s.v(`A${r}`, 'TỔNG', { bold: true, fill: TOTAL_FILL });
  for (const c of ['E', 'F', 'G', 'H', 'I']) {
    const refs = [...teamTotals.values()].map((tr) => `${c}${tr}`);
    s.f(`${c}${r}`, refs.join('+') || '0', [...teamTotals.values()].reduce((a, tr) => a + s.get(tr, c), 0), { bold: true, fill: TOTAL_FILL });
  }
  s.widths({ A: 5, B: 10, C: 24, D: 12, E: 16, F: 13, G: 12, H: 16, I: 13 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 9 }];
  return { teamTotals, total: r };
}

const DARK = fill('FF11395D');
const LIGHT = fill('FFEFF6FF');
const ARIAL: Partial<ExcelJS.Font> = { name: 'Arial', size: 10 };

function dashboardSheet(
  s: Sheet,
  input: WorkbookInput,
  teams: string[],
  refs: { salary: ReturnType<typeof salarySheet>; ctv: ReturnType<typeof ctvSheet>; pit: ReturnType<typeof pitSheet> },
  ctx: Ctx
) {
  const { m: mm, yyyy } = monthParts(input.month);
  const ws = s.ws;
  const band = (addr: string, to: string, text: string, size = 12) => {
    ws.mergeCells(`${addr}:${to}`);
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { ...ARIAL, bold: true, size, color: { argb: 'FFFFFFFF' } };
    c.fill = DARK;
    c.alignment = { vertical: 'middle', horizontal: size > 12 ? 'center' : 'left' };
    ws.getRow(Number(c.row)).height = size > 12 ? 27 : 22;
  };
  const head = (addr: string, text: string, to?: string) => {
    if (to) ws.mergeCells(`${addr}:${to}`);
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { ...ARIAL, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = DARK;
    c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  };
  const cell = (addr: string, formula: string | null, result: number | string, fmt = MONEY, bold = false) => {
    const c = ws.getCell(addr);
    c.value = formula ? ({ formula, result } as ExcelJS.CellFormulaValue) : result;
    c.font = { ...ARIAL, bold };
    c.fill = LIGHT;
    c.border = BORDER;
    c.numFmt = fmt;
    c.alignment = { horizontal: typeof result === 'string' ? 'left' : 'right', vertical: 'middle' };
  };
  const sal = `'${ctx.names.salary}'`;
  const ctv = `'${ctx.names.ctv}'`;
  const pit = `'${ctx.names.pit}'`;
  const slips = input.rows.map((r) => r.payslip);
  const paid = slips.filter((p) => p.gross > 0);
  const sum = (f: (p: Payslip) => number, list = paid) => list.reduce((a, p) => a + f(p), 0);
  const hdld = paid.filter((p) => p.contractType === 'hdld');
  const ctvs = paid.filter((p) => p.contractType !== 'hdld');

  band('A2', 'J2', `TỔNG HỢP LƯƠNG THÁNG ${mm}/${yyyy} — MEIT`, 14);
  band('A4', 'J4', 'I.   TỔNG QUAN');
  const kpis: [string, string, string, number][] = [
    ['B', 'TỔNG SỐ NHÂN SỰ NHẬN LƯƠNG', `COUNTIF(${sal}!$L${refs.salary.first}:$L${refs.salary.last},">0")+COUNTIFS(${ctv}!$B$11:$B${refs.ctv.total},"<>",${ctv}!$E$11:$E${refs.ctv.total},">0")`, paid.length],
    ['D', 'TỔNG TIỀN LƯƠNG', `${sal}!L${refs.salary.total}+${ctv}!E${refs.ctv.total}`, sum((p) => p.gross)],
    ['F', 'THUẾ TNCN KHẤU TRỪ', `${pit}!Q${refs.pit.totalRow}`, sum((p) => p.pit.amount)],
    ['H', 'BH NLĐ ĐÓNG', `${sal}!M${refs.salary.total}`, sum((p) => p.insuranceEmployee.total)],
    ['J', 'THỰC LĨNH', `${sal}!W${refs.salary.total}+${ctv}!H${refs.ctv.total}`, sum((p) => p.net)],
  ];
  for (const [c, label, formula, value] of kpis) {
    const next = c === 'J' ? 'J' : colLetter(colNum(c) + 1);
    head(`${c}6`, label, `${next}6`);
    ws.mergeCells(`${c}7:${next}7`);
    cell(`${c}7`, formula, value, MONEY, true);
  }
  ws.getRow(7).height = 24;

  band('A12', 'J12', 'II.   CƠ CẤU LƯƠNG');
  head('B14', 'Bộ phận', 'B15');
  head('C14', 'Lao động ký HĐLĐ', 'D14');
  head('E14', 'Cộng tác viên (CTV)', 'F14');
  head('G14', 'Tổng', 'J14');
  ['Số NV', 'Tổng lương', 'Số NV', 'Tổng lương', 'Số NV', 'Tổng lương', '% lương', '% lao động'].forEach((t, i) => head(`${colLetter(3 + i)}15`, t));
  const salRange = (col: string) => `${sal}!$${col}$${refs.salary.first}:$${col}$${refs.salary.last}`;
  const ctvRange = (col: string) => `${ctv}!$${col}$11:$${col}$${refs.ctv.total}`;
  let r = 16;
  const firstTeamRow = r;
  const totalTeamRow = 16 + teams.length;
  for (const team of teams) {
    const h = hdld.filter((p) => p.team === team);
    const c = ctvs.filter((p) => p.team === team);
    const label = team || '(chưa xếp team)';
    cell(`B${r}`, null, label, '@', true);
    cell(`C${r}`, `COUNTIFS(${salRange('D')},B${r},${salRange('L')},">0")`, h.length, '0');
    cell(`D${r}`, `SUMIF(${salRange('D')},B${r},${salRange('L')})`, sum((p) => p.gross, h));
    cell(`E${r}`, `COUNTIFS(${ctvRange('D')},B${r},${ctvRange('E')},">0")`, c.length, '0');
    cell(`F${r}`, `SUMIF(${ctvRange('D')},B${r},${ctvRange('E')})`, sum((p) => p.gross, c));
    cell(`G${r}`, `C${r}+E${r}`, h.length + c.length, '0');
    cell(`H${r}`, `D${r}+F${r}`, sum((p) => p.gross, [...h, ...c]));
    const totalGross = sum((p) => p.gross);
    cell(`I${r}`, `IFERROR(H${r}/H${totalTeamRow},0)`, totalGross ? sum((p) => p.gross, [...h, ...c]) / totalGross : 0, '0.0%');
    cell(`J${r}`, `IFERROR(G${r}/G${totalTeamRow},0)`, paid.length ? (h.length + c.length) / paid.length : 0, '0.0%');
    r++;
  }
  cell(`B${r}`, null, 'TỔNG', '@', true);
  for (const [c, fmt, value] of [
    ['C', '0', hdld.length], ['D', MONEY, sum((p) => p.gross, hdld)], ['E', '0', ctvs.length], ['F', MONEY, sum((p) => p.gross, ctvs)],
    ['G', '0', paid.length], ['H', MONEY, sum((p) => p.gross)],
  ] as [string, string, number][]) {
    cell(`${c}${r}`, `SUM(${c}${firstTeamRow}:${c}${r - 1})`, value, fmt, true);
  }
  cell(`I${r}`, null, 1, '0%', true);
  cell(`J${r}`, null, 1, '0%', true);

  r += 2;
  band(`A${r}`, `J${r}`, 'III.   THUẾ THU NHẬP CÁ NHÂN (TNCN)');
  r += 2;
  ['Đối tượng', 'Số NV', 'TN chịu thuế', 'Thuế TNCN', '% thuế', 'Cách tính thuế'].forEach((t, i) => head(`${colLetter(2 + i)}${r}`, t));
  r++;
  const pitRows: [string, number, number, number, string, number][] = [
    ['Lao động chính thức', hdld.length, refs.pit.hdldTotalRow, sum((p) => p.pit.amount, hdld), 'Biểu thuế lũy tiến từng phần', sum((p) => p.taxableIncome, hdld)],
    ['Cộng tác viên', ctvs.length, refs.pit.ctvTotalRow, sum((p) => p.pit.amount, ctvs), `Khấu trừ ${+(ctx.settings.pit.ctvRate * 100).toFixed(2)}% khi thu nhập từ ${ctx.settings.pit.ctvThreshold.toLocaleString('vi-VN')}đ`, sum((p) => p.taxableIncome, ctvs)],
  ];
  const pitFirst = r;
  const totalPit = sum((p) => p.pit.amount);
  for (const [label, n, totalRow, tax, how, taxable] of pitRows) {
    cell(`B${r}`, null, label, '@', true);
    cell(`C${r}`, null, n, '0');
    cell(`D${r}`, `${pit}!J${totalRow}`, taxable);
    cell(`E${r}`, `${pit}!Q${totalRow}`, tax);
    cell(`F${r}`, `IFERROR(E${r}/E${pitFirst + 2},0)`, totalPit ? tax / totalPit : 0, '0.0%');
    cell(`G${r}`, null, how, '@');
    ws.mergeCells(`G${r}:J${r}`);
    r++;
  }
  cell(`B${r}`, null, 'TỔNG THUẾ TNCN', '@', true);
  cell(`C${r}`, `C${r - 2}+C${r - 1}`, paid.length, '0', true);
  cell(`D${r}`, `D${r - 2}+D${r - 1}`, sum((p) => p.taxableIncome), MONEY, true);
  cell(`E${r}`, `E${r - 2}+E${r - 1}`, totalPit, MONEY, true);
  cell(`F${r}`, null, 1, '0%', true);

  r += 2;
  band(`A${r}`, `J${r}`, 'IV.   BẢO HIỂM XÃ HỘI (BHXH / BHYT / BHTN)');
  r += 2;
  ['Khoản mục', 'NLĐ tham gia', 'Tỷ lệ NLĐ', 'Tỷ lệ CTY', 'NLĐ đóng', 'CTY đóng', 'Tổng phát sinh'].forEach((t, i) => head(`${colLetter(2 + i)}${r}`, t));
  r++;
  const insured = slips.filter((p) => p.insuranceEmployee.total > 0);
  const I = ctx.settings.insurance;
  const items: [string, keyof typeof I.employee, string, string][] = [
    ['BHXH', 'bhxh', 'N', 'Y'],
    ['BHYT', 'bhyt', 'O', 'Z'],
    ['BHTN', 'bhtn', 'P', 'AA'],
  ];
  const insFirst = r;
  for (const [label, key, eCol, cCol] of items) {
    const e = sum((p) => p.insuranceEmployee[key], insured);
    const c = sum((p) => p.insuranceCompany[key], insured);
    cell(`B${r}`, null, label, '@', true);
    cell(`C${r}`, null, insured.length, '0');
    cell(`D${r}`, null, I.employee[key], '0.0%');
    cell(`E${r}`, null, I.company[key], '0.0%');
    cell(`F${r}`, `${sal}!${eCol}${refs.salary.total}`, e);
    cell(`G${r}`, `${sal}!${cCol}${refs.salary.total}`, c);
    cell(`H${r}`, `F${r}+G${r}`, e + c);
    r++;
  }
  cell(`B${r}`, null, 'TỔNG BẢO HIỂM', '@', true);
  cell(`C${r}`, null, insured.length, '0', true);
  for (const c of ['F', 'G', 'H']) {
    cell(`${c}${r}`, `SUM(${c}${insFirst}:${c}${r - 1})`, insured.reduce((a, p) => a + (c === 'F' ? p.insuranceEmployee.total - p.insuranceEmployee.union : c === 'G' ? p.insuranceCompany.total - p.insuranceCompany.union : p.insuranceEmployee.total - p.insuranceEmployee.union + p.insuranceCompany.total - p.insuranceCompany.union), 0), MONEY, true);
  }
  ws.getColumn('A').width = 2;
  for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) ws.getColumn(c).width = c === 'B' ? 22 : 15;
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return { teamFirstRow: firstTeamRow };
}

function comparisonSheet(s: Sheet, input: WorkbookInput, teams: string[], dashboardTeamRow: number) {
  const { mm, yyyy } = monthParts(input.month);
  const ws = s.ws;
  const prev = input.previous;
  const prevLabel = prev ? (() => { const p = monthParts(prev.month); return `T${p.mm}/${p.yyyy}`; })() : 'kỳ trước';
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = `BẢNG TỔNG HỢP THAY ĐỔI LƯƠNG THÁNG ${mm}/${yyyy} (MEIT)`;
  ws.getCell('A1').font = { ...FONT, bold: true, size: 12 };
  ['Team', `Lương ${prevLabel} (đ)`, `Lương T${mm}/${yyyy} (đ)`, 'Chênh lệch (đ)', 'Nguyên nhân cụ thể'].forEach((t, i) => s.header(`${colLetter(1 + i)}3`, t));
  let r = 4;
  for (const [i, team] of teams.entries()) {
    const cur = input.rows.filter((x) => x.employee.team === team).reduce((a, x) => a + x.payslip.gross, 0);
    const before = prev?.grossByTeam[team];
    s.v(`A${r}`, team || '(chưa xếp team)', { bold: true });
    s.v(`B${r}`, before ?? null);
    s.f(`C${r}`, `'TH LƯƠNG'!H${dashboardTeamRow + i}`, cur);
    if (before !== undefined) s.f(`D${r}`, `C${r}-B${r}`, cur - before);
    else s.v(`D${r}`, null);
    s.v(`E${r}`, null, { wrap: true });
    r++;
  }
  s.v(`A${r}`, 'TỔNG', { bold: true, fill: TOTAL_FILL });
  for (const c of ['B', 'C', 'D']) {
    let total = 0;
    for (let x = 4; x < r; x++) total += s.get(x, c);
    s.f(`${c}${r}`, `SUM(${c}4:${c}${r - 1})`, total, { bold: true, fill: TOTAL_FILL });
  }
  s.v(`E${r}`, null, { fill: TOTAL_FILL });
  if (!prev) {
    ws.getCell(`A${r + 2}`).value = 'Chưa có kỳ lương tháng trước trong hệ thống — nhập cột B bằng tay nếu cần so sánh.';
    ws.getCell(`A${r + 2}`).font = { ...FONT, italic: true };
  }
  s.widths({ A: 14, B: 18, C: 18, D: 16, E: 50 });
}

function employeesSheet(s: Sheet, employees: PayrollEmployee[], month: string) {
  const ws = s.ws;
  ws.mergeCells('A4:O4');
  ws.getCell('A4').value = 'THÔNG TIN CHUNG VỀ NGƯỜI LAO ĐỘNG';
  ws.getCell('A4').font = { ...FONT, bold: true, size: 12 };
  ws.getCell('A4').alignment = { horizontal: 'center' };
  ws.getCell('A5').value = `NĂM ${month.slice(0, 4)}`;
  const heads = ['STT', 'Mã nhân viên', 'Họ và tên', 'Quê quán', 'Địa chỉ thường trú', 'Giới tính', 'Năm sinh', 'Trình độ', 'Chuyên ngành', 'Mã số thuế', 'CMT/CCCD', 'Ngày cấp', 'Nơi cấp', 'Vị trí công việc/ Chức danh', 'Nhóm', 'Loại HĐ', 'Mức đóng BH', 'Số NPT', 'Đang làm'];
  heads.forEach((t, i) => s.header(`${colLetter(1 + i)}8`, t));
  employees.forEach((e, i) => {
    const r = 11 + i;
    s.v(`A${r}`, i + 1, { align: 'center', money: false });
    s.v(`B${r}`, e.code, { bold: true, align: 'center' });
    s.v(`C${r}`, e.fullName);
    for (const c of ['D', 'E', 'F', 'G', 'H', 'I', 'L', 'M']) s.v(`${c}${r}`, null);
    s.v(`J${r}`, e.taxCode || null);
    s.v(`K${r}`, e.idNumber || null);
    s.v(`N${r}`, e.position || null);
    s.v(`O${r}`, e.team || null);
    s.v(`P${r}`, e.contractType === 'hdld' ? 'HĐLĐ' : 'CTV');
    s.v(`Q${r}`, e.insuranceBase);
    s.v(`R${r}`, e.dependents, { money: false });
    s.v(`S${r}`, e.isActive ? 'x' : null, { align: 'center' });
  });
  s.widths({ A: 5, B: 10, C: 24, J: 14, K: 15, N: 22, O: 10, P: 8, Q: 12 });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 8 }];
}

const GROUP_LABEL: Record<string, string> = {
  position: 'Lương vị trí',
  performance: 'Lương hiệu quả',
  bonus: 'Thưởng',
  meal: 'Tiền ăn ca',
  ot: 'OT/làm đêm',
};

function detailSheet(s: Sheet, rows: WorkbookRow[]) {
  ['Mã nhân viên', 'Họ và tên', 'Team', 'Khoản', 'Nhóm', 'Số lượng', 'Đơn giá / tỷ lệ', 'Thành tiền', 'Miễn thuế'].forEach((t, i) => s.header(`${colLetter(1 + i)}1`, t));
  let r = 2;
  for (const { employee, payslip } of rows) {
    for (const l of payslip.lines) {
      s.v(`A${r}`, employee.code);
      s.v(`B${r}`, employee.fullName);
      s.v(`C${r}`, employee.team);
      s.v(`D${r}`, l.label);
      s.v(`E${r}`, GROUP_LABEL[l.group] ?? l.group);
      s.v(`F${r}`, l.qty ?? null, { money: false });
      s.v(`G${r}`, l.rate ?? null, { money: l.rate !== undefined && l.rate >= 1 });
      s.v(`H${r}`, l.amount);
      s.v(`I${r}`, l.taxExempt ? 'x' : null, { align: 'center' });
      r++;
    }
  }
  s.widths({ A: 10, B: 24, C: 10, D: 34, E: 14, F: 12, G: 14, H: 14, I: 9 });
  s.ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export const INPUT_SHEET = 'Số liệu nhập';

export const ENTRY_FIELDS: [keyof PayrollEntry, string][] = [
  ['bonus', 'Thưởng'],
  ['advance', 'Tạm ứng'],
  ['carryOver', 'Bù trừ kỳ trước (+ cộng / − trừ)'],
  ['pitOverride', 'Thuế TNCN nhập tay (trống = tự tính)'],
  ['note', 'Ghi chú'],
];

/** Metric keys used by these employees, in first-seen order, with labels. */
export function metricColumns(employees: PayrollEmployee[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const e of employees) {
    for (const c of e.components) {
      for (const key of componentMetrics(c)) {
        if (!seen.has(key)) seen.set(key, metricLabel(key, 'metric' in c ? c.label : undefined));
      }
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

/** Row 1 = labels, row 2 = machine keys (keep it), data from row 3 — read back by parseInputSheet. */
function inputSheet(s: Sheet, rows: WorkbookRow[]) {
  const employees = rows.map((r) => r.employee);
  const columns = metricColumns(employees);
  const all = [['code', 'Mã nhân viên'], ['fullName', 'Họ và tên'], ['team', 'Team'], ...columns.map((c) => [c.key, c.label]), ...ENTRY_FIELDS.map(([k, l]) => [k as string, l])];
  all.forEach(([key, label], i) => {
    s.header(`${colLetter(1 + i)}1`, label);
    const k = s.ws.getCell(`${colLetter(1 + i)}2`);
    k.value = key;
    k.font = { ...FONT, italic: true, color: { argb: 'FF808080' } };
  });
  rows.forEach(({ employee, entry }, i) => {
    const r = 3 + i;
    const used = new Set(employee.components.flatMap(componentMetrics));
    s.v(`A${r}`, employee.code);
    s.v(`B${r}`, employee.fullName);
    s.v(`C${r}`, employee.team);
    columns.forEach((c, j) => {
      const addr = `${colLetter(4 + j)}${r}`;
      if (used.has(c.key)) s.v(addr, entry.metrics[c.key] ?? 0, { money: false });
      else s.v(addr, null, { fill: HEADER_FILL });
    });
    ENTRY_FIELDS.forEach(([k], j) => {
      const addr = `${colLetter(4 + columns.length + j)}${r}`;
      const value = entry[k];
      if (k === 'note') s.v(addr, (value as string) || null);
      else if (k === 'pitOverride') s.v(addr, typeof value === 'number' ? value : null);
      else s.v(addr, (value as number) || 0);
    });
  });
  s.widths({ A: 10, B: 24, C: 10 });
  s.ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 2 }];
}

// ---- assembly ----

const TEAM_SHEETS: { name: string; teams: string[] }[] = [
  { name: 'LƯƠNG TEAM LIVE', teams: ['Live'] },
  { name: 'LƯƠNG TEAM MEDIA', teams: ['Media'] },
  // Marketing also takes anyone without a known team: its layout is all fixed/% amounts + "Khoản khác".
  { name: 'LƯƠNG TEAM MARKETING', teams: ['Marketing'] },
  { name: 'LƯƠNG NGƯỜI MẪU', teams: ['Mẫu'] },
  { name: 'LƯƠNG TEAM SALE', teams: ['Sale'] },
  { name: 'KHO -KẾ TOÁN', teams: ['Kho', 'Kế toán'] },
];
const KNOWN_TEAMS = new Set(TEAM_SHEETS.flatMap((t) => t.teams));

export async function buildPayrollWorkbook(input: WorkbookInput): Promise<Buffer> {
  sheetsByName.clear();
  const names = sheetNames(input.month);
  const ctx: Ctx = { names, settings: input.settings };
  const { m: mNum, yyyy } = monthParts(input.month);
  const monthText = `Tháng ${mNum}/${yyyy}`;
  const company = input.companyName ?? 'HỘ KINH DOANH HAPPY LIFE';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MeiT Tools';
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  // Sheet order mirrors the hand-made workbook.
  const add = (name: string, tab?: string) => {
    const s = new Sheet(wb.addWorksheet(name, tab ? { properties: { tabColor: { argb: tab } } } : undefined));
    sheetsByName.set(name, s);
    return s;
  };
  const dash = add('TH LƯƠNG', 'FF11395D');
  const cmp = add('SS LƯƠNG');
  const salary = add(names.salary, 'FF70AD47');
  const ctv = add(names.ctv, 'FF70AD47');
  const pit = add(names.pit, 'FFFFC000');
  const team = new Map(TEAM_SHEETS.map((t) => [t.name, add(t.name, 'FF5B9BD5')]));
  const info = add('Thông tin lao động');
  const detail = add('Chi tiết');
  const inputs = add(INPUT_SHEET);

  const sheetFor = (t: string) => TEAM_SHEETS.find((x) => x.teams.includes(t))?.name ?? 'LƯƠNG TEAM MARKETING';
  const placed: Placed[] = [];
  for (const def of TEAM_SHEETS) {
    const rows = input.rows.filter((r) => sheetFor(r.employee.team) === def.name);
    if (def.name === 'LƯƠNG TEAM MARKETING') {
      // Unknown teams after the real marketers.
      rows.sort((a, b) => Number(!KNOWN_TEAMS.has(a.employee.team)) - Number(!KNOWN_TEAMS.has(b.employee.team)));
    }
    const s = team.get(def.name)!;
    const layout =
      def.name === 'LƯƠNG TEAM LIVE' ? liveSheet(s, rows, ctx, monthText)
      : def.name === 'LƯƠNG TEAM MEDIA' ? mediaSheet(s, rows, ctx, monthText)
      : def.name === 'LƯƠNG TEAM MARKETING' ? marketingSheet(s, rows, ctx, monthText)
      : def.name === 'LƯƠNG NGƯỜI MẪU' ? modelSheet(s, rows, ctx, monthText)
      : officeSheet(s, rows, ctx, monthText, def.name === 'LƯƠNG TEAM SALE' ? 'sale' : 'kho');
    for (const row of rows) placed.push({ row, layout, teamSheet: s });
  }

  const pitRefs = pitSheet(pit, placed, ctx, input.month);
  const salaryRefs = salarySheet(salary, placed, ctx, input.month, company);
  const ctvRefs = ctvSheet(ctv, placed, input.month, ctx, company);
  const teams = [...new Set(input.rows.filter((r) => r.payslip.gross > 0 || r.employee.isActive).map((r) => r.employee.team))]
    .sort((a, b) => {
      const order = ['Live', 'Media', 'Marketing', 'Sale', 'Kho', 'Kế toán', 'Mẫu'];
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  const { teamFirstRow } = dashboardSheet(dash, input, teams, { salary: salaryRefs, ctv: ctvRefs, pit: pitRefs }, ctx);
  comparisonSheet(cmp, input, teams, teamFirstRow);
  employeesSheet(info, input.rows.map((r) => r.employee), input.month);
  detailSheet(detail, input.rows);
  inputSheet(inputs, input.rows);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
