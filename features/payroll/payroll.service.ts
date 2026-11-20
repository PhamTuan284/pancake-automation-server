import {
  PayrollEmployeeModel,
  PayrollPeriodModel,
  PayrollSettingsModel,
  type PayrollPeriodDoc,
} from '../../common/models/payrollModel';
import { logAudit } from '../../common/models/auditLogModel';
import { computePayslip, emptyEntry, summarize, type PayrollSummary } from './payroll.engine';
import { CODE_RE, parsePayrollWorkbook } from './excelImport';
import { buildEmployeesWorkbook, metricColumns, parseInputSheet } from './excelExport';
import { buildPayrollWorkbook } from './excelWorkbook';
import {
  DEFAULT_PAYROLL_SETTINGS,
  PAY_GROUPS,
  type PayComponent,
  type PayGroup,
  type PayrollEmployee,
  type PayrollEntry,
  type PayrollSettings,
  type Payslip,
} from './payroll.types';

export class PayrollInputError extends Error {}
export class PayrollNotFoundError extends Error {}

type Auth = { username: string };

// ---- parsing helpers ----

function toNumber(value: unknown, label: string, { min = -Infinity } = {}): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new PayrollInputError(`"${label}" phải là số.`);
  if (n < min) throw new PayrollInputError(`"${label}" không được nhỏ hơn ${min}.`);
  return n;
}

function toText(value: unknown): string {
  return String(value ?? '').trim();
}

function parseMonth(value: unknown): string {
  const month = toText(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PayrollInputError('Tháng phải có dạng YYYY-MM.');
  return month;
}

function parseCode(value: unknown): string {
  const code = toText(value).toUpperCase();
  if (!CODE_RE.test(code)) throw new PayrollInputError('Mã nhân viên phải bắt đầu bằng chữ và có số (vd MT001, CTV012) — giống mã trong file Excel.');
  return code;
}

function parseGroup(value: unknown): PayGroup {
  const g = toText(value) as PayGroup;
  if (!PAY_GROUPS.includes(g)) throw new PayrollInputError(`Nhóm lương "${String(value)}" không hợp lệ.`);
  return g;
}

function parseMetricKey(value: unknown, label: string): string {
  const key = toText(value);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) throw new PayrollInputError(`"${label}": mã chỉ số không hợp lệ.`);
  return key;
}

export function parseComponent(raw: unknown, index: number): PayComponent {
  const c = (raw ?? {}) as Record<string, unknown>;
  const label = toText(c.label) || `Khoản ${index + 1}`;
  const id = toText(c.id) || `c${index + 1}`;
  const base = { id, label };
  switch (c.kind) {
    case 'qty_rate': {
      const max = toNumber(c.max, `${label} – mức trần`, { min: 0 });
      return {
        ...base,
        kind: 'qty_rate',
        metric: parseMetricKey(c.metric, label),
        rate: toNumber(c.rate, `${label} – đơn giá`, { min: 0 }),
        ...(max > 0 ? { max } : {}),
        group: parseGroup(c.group),
        ...(c.taxExempt ? { taxExempt: true } : {}),
      };
    }
    case 'fixed':
      return {
        ...base,
        kind: 'fixed',
        amount: toNumber(c.amount, `${label} – số tiền`),
        group: parseGroup(c.group),
        ...(c.taxExempt ? { taxExempt: true } : {}),
      };
    case 'percent': {
      const threshold = c.threshold === undefined || c.threshold === null || c.threshold === '' ? undefined : toNumber(c.threshold, `${label} – ngưỡng`, { min: 0 });
      const weight = c.weight === undefined || c.weight === null || c.weight === '' ? undefined : toNumber(c.weight, `${label} – tỷ trọng`, { min: 0 });
      return {
        ...base,
        kind: 'percent',
        metric: parseMetricKey(c.metric, label),
        pct: toNumber(c.pct, `${label} – tỷ lệ`, { min: 0 }),
        ...(weight !== undefined && weight !== 1 ? { weight } : {}),
        ...(threshold ? { threshold } : {}),
        group: parseGroup(c.group),
      };
    }
    case 'kpi_base':
      return {
        ...base,
        kind: 'kpi_base',
        metric: parseMetricKey(c.metric, label),
        baseAmount: toNumber(c.baseAmount, `${label} – lương KPI`, { min: 0 }),
        includedQty: toNumber(c.includedQty, `${label} – số lượng KPI`, { min: 0 }),
        overRate: toNumber(c.overRate, `${label} – đơn giá vượt`, { min: 0 }),
        group: parseGroup(c.group),
      };
    case 'live_hours': {
      const standardAmount = toNumber(c.standardAmount, `${label} – lương tiêu chuẩn`, { min: 0 });
      return {
        ...base,
        kind: 'live_hours',
        rate: toNumber(c.rate, `${label} – đơn giá giờ`, { min: 0 }),
        ...(standardAmount > 0 ? { standardAmount } : {}),
      };
    }
    default:
      throw new PayrollInputError(`Loại khoản lương "${String(c.kind)}" không hợp lệ.`);
  }
}

function parseEmployee(raw: Record<string, unknown>, code: string): PayrollEmployee {
  const components = Array.isArray(raw.components) ? raw.components.map(parseComponent) : [];
  const ids = new Set<string>();
  for (const c of components) {
    if (ids.has(c.id)) c.id = `${c.id}-${ids.size + 1}`;
    ids.add(c.id);
  }
  const contractType = raw.contractType === 'hdld' ? 'hdld' : 'ctv';
  return {
    code,
    fullName: toText(raw.fullName),
    team: toText(raw.team),
    position: toText(raw.position),
    contractType,
    insuranceBase: contractType === 'hdld' ? toNumber(raw.insuranceBase, 'Mức đóng BH', { min: 0 }) : 0,
    taxCode: toText(raw.taxCode),
    idNumber: toText(raw.idNumber),
    dependents: toNumber(raw.dependents, 'Số người phụ thuộc', { min: 0 }),
    username: toText(raw.username),
    payNote: String(raw.payNote ?? ''),
    components,
    isActive: raw.isActive !== false,
  };
}

function parseEntry(raw: Record<string, unknown>): PayrollEntry {
  const code = parseCode(raw.code);
  const metrics: Record<string, number> = {};
  const rawMetrics = (raw.metrics ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawMetrics)) {
    const n = toNumber(value, `${code} – ${key}`);
    if (n !== 0) metrics[parseMetricKey(key, key)] = n;
  }
  return {
    code,
    metrics,
    bonus: toNumber(raw.bonus, `${code} – thưởng`),
    advance: toNumber(raw.advance, `${code} – tạm ứng`),
    carryOver: toNumber(raw.carryOver, `${code} – bù trừ`),
    note: String(raw.note ?? '').slice(0, 500),
    pitOverride:
      raw.pitOverride === undefined || raw.pitOverride === null || raw.pitOverride === ''
        ? null
        : toNumber(raw.pitOverride, `${code} – thuế nhập tay`, { min: 0 }),
  };
}

function parseSettings(raw: unknown): PayrollSettings {
  const s = (raw ?? {}) as Record<string, any>;
  const rates = (r: any, label: string) => ({
    bhxh: toNumber(r?.bhxh, `${label} BHXH`, { min: 0 }),
    bhyt: toNumber(r?.bhyt, `${label} BHYT`, { min: 0 }),
    bhtn: toNumber(r?.bhtn, `${label} BHTN`, { min: 0 }),
    union: toNumber(r?.union, `${label} công đoàn`, { min: 0 }),
  });
  const brackets = Array.isArray(s.pit?.brackets) ? s.pit.brackets : [];
  if (brackets.length === 0) throw new PayrollInputError('Biểu thuế lũy tiến cần ít nhất một bậc.');
  return {
    insurance: { employee: rates(s.insurance?.employee, 'NLĐ'), company: rates(s.insurance?.company, 'Công ty') },
    pit: {
      personalDeduction: toNumber(s.pit?.personalDeduction, 'Giảm trừ bản thân', { min: 0 }),
      dependentDeduction: toNumber(s.pit?.dependentDeduction, 'Giảm trừ người phụ thuộc', { min: 0 }),
      brackets: brackets.map((b: any, i: number) => ({
        upTo: b?.upTo === null || b?.upTo === '' || b?.upTo === undefined ? null : toNumber(b.upTo, `Bậc ${i + 1} – mức trên`, { min: 0 }),
        rate: toNumber(b?.rate, `Bậc ${i + 1} – thuế suất`, { min: 0 }),
      })),
      ctvThreshold: toNumber(s.pit?.ctvThreshold, 'Ngưỡng khấu trừ CTV', { min: 0 }),
      ctvRate: toNumber(s.pit?.ctvRate, 'Tỷ lệ khấu trừ CTV', { min: 0 }),
    },
    live: {
      nightMultiplier: toNumber(s.live?.nightMultiplier, 'Hệ số live đêm', { min: 0 }),
      sundayBonusPct: toNumber(s.live?.sundayBonusPct, 'Thưởng live chủ nhật', { min: 0 }),
      holidayMultiplier: toNumber(s.live?.holidayMultiplier, 'Hệ số ngày lễ', { min: 0 }),
    },
  };
}

// ---- settings ----

export async function getSettings(): Promise<PayrollSettings> {
  const doc = await PayrollSettingsModel.findOne({ key: 'default' }).lean();
  return doc?.settings ?? DEFAULT_PAYROLL_SETTINGS;
}

export async function updateSettings(auth: Auth, raw: unknown): Promise<PayrollSettings> {
  const settings = parseSettings(raw);
  await PayrollSettingsModel.updateOne({ key: 'default' }, { $set: { settings } }, { upsert: true });
  logAudit(auth.username, 'payroll.settings', 'Cập nhật cài đặt bảo hiểm/thuế');
  return settings;
}

// ---- employees ----

function toEmployee(doc: Record<string, any>): PayrollEmployee {
  return {
    code: doc.code,
    fullName: doc.fullName ?? '',
    team: doc.team ?? '',
    position: doc.position ?? '',
    contractType: doc.contractType === 'hdld' ? 'hdld' : 'ctv',
    insuranceBase: doc.insuranceBase ?? 0,
    taxCode: doc.taxCode ?? '',
    idNumber: doc.idNumber ?? '',
    dependents: doc.dependents ?? 0,
    username: doc.username ?? '',
    payNote: doc.payNote ?? '',
    components: (doc.components ?? []) as PayComponent[],
    isActive: doc.isActive !== false,
  };
}

const TEAM_ORDER = ['Live', 'Media', 'Marketing', 'Sale', 'Kho', 'Kế toán', 'Mẫu'];
function byTeamThenCode(a: { team: string; code: string }, b: { team: string; code: string }) {
  const ta = TEAM_ORDER.indexOf(a.team);
  const tb = TEAM_ORDER.indexOf(b.team);
  return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb) || a.code.localeCompare(b.code, 'en', { numeric: true });
}

export async function listEmployees(): Promise<PayrollEmployee[]> {
  const docs = await PayrollEmployeeModel.find().lean();
  return docs.map(toEmployee).sort(byTeamThenCode);
}

export async function saveEmployee(auth: Auth, originalCode: string | null, raw: Record<string, unknown>) {
  const code = parseCode(raw.code ?? originalCode);
  const employee = parseEmployee(raw, code);
  if (originalCode && originalCode !== code) {
    if (await PayrollEmployeeModel.exists({ code })) throw new PayrollInputError(`Mã ${code} đã tồn tại.`);
    await PayrollEmployeeModel.deleteOne({ code: originalCode });
    // Keep draft inputs attached to the renamed code.
    await PayrollPeriodModel.updateMany(
      { status: 'draft', 'entries.code': originalCode },
      { $set: { 'entries.$[e].code': code } },
      { arrayFilters: [{ 'e.code': originalCode }] }
    );
  } else if (!originalCode && (await PayrollEmployeeModel.exists({ code }))) {
    throw new PayrollInputError(`Mã ${code} đã tồn tại.`);
  }
  await PayrollEmployeeModel.updateOne({ code }, { $set: employee }, { upsert: true });
  logAudit(auth.username, 'payroll.employee', `${originalCode ? 'Sửa' : 'Thêm'} ${code} – ${employee.fullName}`);
  return employee;
}

export async function deleteEmployee(auth: Auth, code: string) {
  const res = await PayrollEmployeeModel.deleteOne({ code: parseCode(code) });
  if (res.deletedCount === 0) throw new PayrollNotFoundError('Không tìm thấy nhân viên.');
  logAudit(auth.username, 'payroll.employee', `Xóa ${code}`);
}

// ---- periods ----

export type PeriodRow = { employee: PayrollEmployee; entry: PayrollEntry; payslip: Payslip };

export type PeriodView = {
  month: string;
  status: PayrollPeriodDoc['status'];
  lockedAt?: Date;
  lockedBy?: string;
  rows: PeriodRow[];
  summary: PayrollSummary;
  metricColumns: Record<string, { key: string; label: string }[]>;
};

async function loadPeriod(month: string) {
  const period = await PayrollPeriodModel.findOne({ month: parseMonth(month) });
  if (!period) throw new PayrollNotFoundError(`Chưa có kỳ lương ${month}.`);
  return period;
}

/** Draft: live employees (active, or with inputs this month) × current settings. Locked: the snapshot. */
async function computeRows(period: PayrollPeriodDoc): Promise<{ rows: PeriodRow[]; employees: PayrollEmployee[] }> {
  const entries = new Map((period.entries ?? []).map((e) => [e.code, e]));
  if (period.status === 'locked') {
    const employees = period.employeesSnapshot.map(toEmployee);
    const slips = new Map(period.payslips.map((p) => [p.code, p]));
    const rows = employees.map((employee) => ({
      employee,
      entry: entries.get(employee.code) ?? emptyEntry(employee.code),
      payslip: slips.get(employee.code)!,
    }));
    return { rows: rows.filter((r) => r.payslip), employees };
  }
  const employees = (await listEmployees()).filter((e) => e.isActive || entries.has(e.code));
  const rows = employees.map((employee) => {
    const entry = entries.get(employee.code) ?? emptyEntry(employee.code);
    return { employee, entry, payslip: computePayslip(employee, entry, period.settings) };
  });
  return { rows, employees };
}

function viewOf(period: PayrollPeriodDoc, rows: PeriodRow[], employees: PayrollEmployee[]): PeriodView {
  const columns: PeriodView['metricColumns'] = {};
  for (const team of new Set(employees.map((e) => e.team))) {
    columns[team] = metricColumns(employees.filter((e) => e.team === team));
  }
  return {
    month: period.month,
    status: period.status,
    lockedAt: period.lockedAt,
    lockedBy: period.lockedBy,
    rows,
    summary: summarize(rows.map((r) => r.payslip)),
    metricColumns: columns,
  };
}

export async function listPeriods() {
  const periods = await PayrollPeriodModel.find().sort({ month: -1 }).lean();
  return Promise.all(
    periods.map(async (p) => {
      const { rows } = await computeRows(p as PayrollPeriodDoc);
      const s = summarize(rows.map((r) => r.payslip));
      return { month: p.month, status: p.status, lockedAt: p.lockedAt, headcount: s.headcount, gross: s.gross, net: s.net };
    })
  );
}

export async function getPeriod(month: string): Promise<PeriodView> {
  const period = await loadPeriod(month);
  const { rows, employees } = await computeRows(period.toObject());
  return viewOf(period.toObject(), rows, employees);
}

export async function createPeriod(auth: Auth, rawMonth: unknown): Promise<PeriodView> {
  const month = parseMonth(rawMonth);
  if (await PayrollPeriodModel.exists({ month })) throw new PayrollInputError(`Kỳ lương ${month} đã tồn tại.`);
  await PayrollPeriodModel.create({ month, status: 'draft', entries: [], settings: await getSettings() });
  logAudit(auth.username, 'payroll.period', `Tạo kỳ lương ${month}`);
  return getPeriod(month);
}

function assertDraft(period: { status: string; month: string }) {
  if (period.status === 'locked') throw new PayrollInputError(`Kỳ ${period.month} đã chốt — mở chốt trước khi sửa.`);
}

function mergeEntries(current: PayrollEntry[], incoming: PayrollEntry[]): PayrollEntry[] {
  const map = new Map(current.map((e) => [e.code, e]));
  for (const e of incoming) map.set(e.code, e);
  return [...map.values()];
}

/** Replaces the given employees' inputs (whole entry per code). */
export async function saveEntries(auth: Auth, month: string, raw: unknown): Promise<PeriodView> {
  if (!Array.isArray(raw)) throw new PayrollInputError('Thiếu danh sách số liệu.');
  const incoming = raw.map((r) => parseEntry((r ?? {}) as Record<string, unknown>));
  const period = await loadPeriod(month);
  assertDraft(period);
  period.entries = mergeEntries(period.entries, incoming);
  period.markModified('entries');
  await period.save();
  logAudit(auth.username, 'payroll.entries', `Cập nhật số liệu ${month}: ${incoming.map((e) => e.code).join(', ')}`);
  return getPeriod(month);
}

/** Re-applies the current global settings to a draft period (rates/thresholds change rarely). */
export async function refreshPeriodSettings(auth: Auth, month: string): Promise<PeriodView> {
  const period = await loadPeriod(month);
  assertDraft(period);
  period.settings = await getSettings();
  period.markModified('settings');
  await period.save();
  logAudit(auth.username, 'payroll.period', `Áp cài đặt mới cho kỳ ${month}`);
  return getPeriod(month);
}

export async function lockPeriod(auth: Auth, month: string): Promise<PeriodView> {
  const period = await loadPeriod(month);
  assertDraft(period);
  const { rows } = await computeRows(period.toObject());
  period.employeesSnapshot = rows.map((r) => r.employee);
  period.payslips = rows.map((r) => r.payslip);
  period.status = 'locked';
  period.lockedAt = new Date();
  period.lockedBy = auth.username;
  period.markModified('employeesSnapshot');
  period.markModified('payslips');
  await period.save();
  logAudit(auth.username, 'payroll.period', `Chốt kỳ lương ${month}`);
  return getPeriod(month);
}

export async function unlockPeriod(auth: Auth, month: string): Promise<PeriodView> {
  const period = await loadPeriod(month);
  if (period.status !== 'locked') throw new PayrollInputError(`Kỳ ${month} chưa chốt.`);
  period.status = 'draft';
  period.employeesSnapshot = [];
  period.payslips = [];
  period.lockedAt = undefined;
  period.lockedBy = undefined;
  await period.save();
  logAudit(auth.username, 'payroll.period', `Mở chốt kỳ lương ${month}`);
  return getPeriod(month);
}

export async function deletePeriod(auth: Auth, month: string) {
  const period = await loadPeriod(month);
  assertDraft(period);
  await period.deleteOne();
  logAudit(auth.username, 'payroll.period', `Xóa kỳ lương ${month}`);
}

// ---- Excel sync ----

const TOLERANCE = 3;

export type ImportPreview = {
  month: string | null;
  periodStatus: 'none' | 'draft' | 'locked';
  warnings: string[];
  employees: { code: string; fullName: string; team: string; isActive: boolean; action: 'create' | 'update' | 'unchanged' }[];
  reconciliation: {
    code: string;
    fullName: string;
    team: string;
    excel: { gross: number; tax: number; net: number };
    app: { gross: number; tax: number; net: number };
    ok: boolean;
  }[];
};

/** JSON with object keys sorted, so components saved from the UI (different key order) still compare equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

function sameEmployee(a: PayrollEmployee, b: PayrollEmployee): boolean {
  const pick = (e: PayrollEmployee) =>
    stableJson([e.fullName, e.team, e.position, e.contractType, e.insuranceBase, e.taxCode, e.idNumber, e.dependents, e.components, e.isActive]);
  return pick(a) === pick(b);
}

/**
 * Parses the monthly workbook and recomputes it with the engine, without
 * writing anything. `ok: false` rows mean the app would pay a different amount
 * than the workbook — fix the employee's components before applying.
 */
export async function previewWorkbookImport(buffer: Buffer): Promise<ImportPreview> {
  const parsed = parsePayrollWorkbook(buffer);
  const settings = await getSettings();
  const existing = new Map((await listEmployees()).map((e) => [e.code, e]));
  const entries = new Map(parsed.entries.map((e) => [e.code, e]));
  const period = parsed.month ? await PayrollPeriodModel.findOne({ month: parsed.month }).lean() : null;

  const reconciliation: ImportPreview['reconciliation'] = [];
  for (const e of parsed.employees.filter((x) => x.isActive)) {
    const slip = computePayslip(e, entries.get(e.code), settings);
    const excel = parsed.expected[e.code];
    if (!excel) continue;
    const app = { gross: slip.gross, tax: slip.pit.amount, net: slip.net };
    const ok =
      Math.abs(app.gross - excel.gross) <= TOLERANCE &&
      Math.abs(app.tax - excel.tax) <= TOLERANCE &&
      Math.abs(app.net - excel.net) <= TOLERANCE;
    reconciliation.push({ code: e.code, fullName: e.fullName, team: e.team, excel: { gross: excel.gross, tax: excel.tax, net: excel.net }, app, ok });
  }

  // Draft periods are computed with the employees' current formulas, so importing a newer
  // month's rates silently changes them. Locked periods keep their own snapshot.
  const warnings = [...parsed.warnings];
  if (parsed.month) {
    const olderDrafts = await PayrollPeriodModel.find({ status: 'draft', month: { $lt: parsed.month } }, { month: 1 }).lean();
    if (olderDrafts.length) {
      warnings.unshift(
        `Kỳ ${olderDrafts.map((p) => p.month).join(', ')} chưa chốt: đồng bộ file này sẽ thay công thức/đơn giá nhân viên và làm đổi số của kỳ đó. Nên chốt kỳ cũ trước.`
      );
    }
  }

  return {
    month: parsed.month,
    periodStatus: period ? period.status : 'none',
    warnings,
    employees: parsed.employees.map((e) => {
      const current = existing.get(e.code);
      const merged = current ? { ...e, username: current.username } : e;
      return {
        code: e.code,
        fullName: e.fullName,
        team: e.team,
        isActive: e.isActive,
        action: !current ? 'create' : sameEmployee(current, merged) ? 'unchanged' : 'update',
      };
    }),
    reconciliation: reconciliation.sort(byTeamThenCode),
  };
}

/**
 * Writes the workbook into the DB: upserts employees by code (the MeiT login
 * link is kept) and, when `withEntries`, replaces that month's inputs.
 */
export async function applyWorkbookImport(auth: Auth, buffer: Buffer, opts: { withEntries: boolean }) {
  const parsed = parsePayrollWorkbook(buffer);
  if (opts.withEntries && !parsed.month) throw new PayrollInputError('Không xác định được tháng lương trong file.');

  const period = opts.withEntries ? await PayrollPeriodModel.findOne({ month: parsed.month }) : null;
  if (period) assertDraft(period);

  const existing = new Map((await listEmployees()).map((e) => [e.code, e]));
  await PayrollEmployeeModel.bulkWrite(
    parsed.employees.map((e) => ({
      updateOne: {
        filter: { code: e.code },
        update: { $set: { ...e, username: existing.get(e.code)?.username ?? '' } },
        upsert: true,
      },
    }))
  );

  if (opts.withEntries && parsed.month) {
    if (!period) {
      await PayrollPeriodModel.create({ month: parsed.month, status: 'draft', entries: parsed.entries, settings: await getSettings() });
    } else {
      period.entries = parsed.entries;
      period.markModified('entries');
      await period.save();
    }
  }
  logAudit(
    auth.username,
    'payroll.import',
    `Import Excel: ${parsed.employees.length} nhân viên${opts.withEntries ? `, số liệu kỳ ${parsed.month}` : ''}`
  );
  return { month: parsed.month, employees: parsed.employees.length, entries: opts.withEntries ? parsed.entries.length : 0 };
}

/** Uploads a filled "Số liệu nhập" sheet (from the exported template) into a draft period. */
export async function importInputSheet(auth: Auth, month: string, buffer: Buffer): Promise<PeriodView> {
  const entries = parseInputSheet(buffer);
  if (!entries) throw new PayrollInputError('File không có sheet "Số liệu nhập" — hãy tải file mẫu từ kỳ lương.');
  const period = await loadPeriod(month);
  assertDraft(period);
  const known = new Set((await listEmployees()).map((e) => e.code));
  const unknown = entries.filter((e) => !known.has(e.code)).map((e) => e.code);
  if (unknown.length) throw new PayrollInputError(`Mã nhân viên chưa có trong hệ thống: ${unknown.join(', ')}.`);
  period.entries = mergeEntries(period.entries, entries);
  period.markModified('entries');
  await period.save();
  logAudit(auth.username, 'payroll.entries', `Import số liệu kỳ ${month} từ Excel (${entries.length} dòng)`);
  return getPeriod(month);
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The month's workbook in the hand-made layout; "SS LƯƠNG" compares with last month's period when there is one. */
export async function exportPeriod(month: string): Promise<Buffer> {
  const period = await loadPeriod(month);
  const { rows } = await computeRows(period.toObject());
  const prevDoc = await PayrollPeriodModel.findOne({ month: previousMonth(period.month) });
  let previous: { month: string; grossByTeam: Record<string, number> } | undefined;
  if (prevDoc) {
    const prevRows = (await computeRows(prevDoc.toObject())).rows;
    const grossByTeam: Record<string, number> = {};
    for (const r of prevRows) grossByTeam[r.employee.team] = (grossByTeam[r.employee.team] ?? 0) + r.payslip.gross;
    previous = { month: prevDoc.month, grossByTeam };
  }
  return buildPayrollWorkbook({ month: period.month, settings: period.settings, rows, previous });
}

export async function exportEmployees(): Promise<Buffer> {
  return buildEmployeesWorkbook(await listEmployees());
}
