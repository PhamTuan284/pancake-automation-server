import {
  PAY_GROUPS,
  type InsuranceAmounts,
  type InsuranceRates,
  type PayComponent,
  type PayGroup,
  type PayLine,
  type PayrollEmployee,
  type PayrollEntry,
  type PayrollSettings,
  type Payslip,
} from './payroll.types';

/**
 * Pure payroll calculation — no DB, no I/O — so it can be golden-tested
 * against the monthly Excel workbook. Every line amount is rounded to the
 * đồng; the workbook keeps fractions, so results may differ by ±1–2đ.
 */

const round = (n: number) => Math.round(n);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function line(
  component: PayComponent,
  label: string,
  group: PayGroup,
  amount: number,
  opts: { qty?: number; rate?: number; taxExempt?: boolean } = {}
): PayLine {
  return {
    componentId: component.id,
    label,
    group,
    qty: opts.qty,
    rate: opts.rate,
    amount: round(amount),
    taxExempt: Boolean(opts.taxExempt),
  };
}

function liveHoursLines(
  c: Extract<PayComponent, { kind: 'live_hours' }>,
  metrics: Record<string, number>,
  settings: PayrollSettings
): PayLine[] {
  const { nightMultiplier, sundayBonusPct, holidayMultiplier } = settings.live;
  const rate = num(c.rate);
  const liveHours = num(metrics.liveHours);
  const night = num(metrics.nightHours);
  const sunday = num(metrics.sundayHours);
  const holiday = num(metrics.holidayHours);
  const standardAmount = num(c.standardAmount);
  const standardHours = standardAmount > 0 && rate > 0 ? standardAmount / rate : 0;
  const regular = Math.max(0, liveHours - standardHours - night);

  const lines: PayLine[] = [];
  if (standardAmount > 0) {
    lines.push(line(c, `${c.label} – tiêu chuẩn`, 'position', standardAmount, { qty: standardHours, rate }));
  }
  lines.push(line(c, c.label, 'performance', regular * rate, { qty: regular, rate }));
  if (night > 0) {
    const r = rate * nightMultiplier;
    lines.push(line(c, `${c.label} – ban đêm`, 'performance', night * r, { qty: night, rate: r, taxExempt: true }));
  }
  if (sunday > 0) {
    const r = rate * sundayBonusPct;
    lines.push(line(c, `${c.label} – thưởng chủ nhật`, 'performance', sunday * r, { qty: sunday, rate: r }));
  }
  if (holiday > 0) {
    const r = rate * holidayMultiplier;
    lines.push(line(c, `${c.label} – ngày lễ`, 'performance', holiday * r, { qty: holiday, rate: r, taxExempt: true }));
  }
  return lines;
}

export function componentLines(
  c: PayComponent,
  metrics: Record<string, number>,
  settings: PayrollSettings
): PayLine[] {
  switch (c.kind) {
    case 'qty_rate': {
      const qty = num(metrics[c.metric]);
      const raw = qty * num(c.rate);
      const amount = c.max !== undefined && c.max !== null && c.max > 0 ? Math.min(raw, c.max) : raw;
      return [line(c, c.label, c.group, amount, { qty, rate: c.rate, taxExempt: c.taxExempt })];
    }
    case 'fixed':
      return [line(c, c.label, c.group, num(c.amount), { taxExempt: c.taxExempt })];
    case 'percent': {
      const base = num(metrics[c.metric]);
      const weight = c.weight ?? 1;
      const reached = c.threshold === undefined || c.threshold === null || base > c.threshold;
      const amount = reached ? base * num(c.pct) * weight : 0;
      return [line(c, c.label, c.group, amount, { qty: base, rate: num(c.pct) * weight })];
    }
    case 'kpi_base': {
      const qty = num(metrics[c.metric]);
      const over = Math.max(0, qty - num(c.includedQty));
      const lines = [line(c, c.label, c.group, num(c.baseAmount), { qty: Math.min(qty, num(c.includedQty)) })];
      if (over > 0) lines.push(line(c, `${c.label} – vượt KPI`, 'performance', over * num(c.overRate), { qty: over, rate: c.overRate }));
      return lines;
    }
    case 'live_hours':
      return liveHoursLines(c, metrics, settings);
  }
}

function insurance(base: number, rates: InsuranceRates): InsuranceAmounts {
  const bhxh = round(base * rates.bhxh);
  const bhyt = round(base * rates.bhyt);
  const bhtn = round(base * rates.bhtn);
  const union = round(base * rates.union);
  return { bhxh, bhyt, bhtn, union, total: bhxh + bhyt + bhtn + union };
}

export function progressiveTax(assessable: number, brackets: PayrollSettings['pit']['brackets']): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (assessable <= lower) break;
    tax += (Math.min(assessable, upper) - lower) * b.rate;
    lower = upper;
  }
  return tax;
}

export function emptyEntry(code: string): PayrollEntry {
  return { code, metrics: {}, bonus: 0, advance: 0, carryOver: 0, note: '' };
}

export function computePayslip(
  employee: PayrollEmployee,
  entry: PayrollEntry | undefined,
  settings: PayrollSettings
): Payslip {
  const e = entry ?? emptyEntry(employee.code);
  const metrics = e.metrics ?? {};

  const lines = employee.components.flatMap((c) => componentLines(c, metrics, settings));
  if (num(e.bonus) !== 0) {
    lines.push({ componentId: 'bonus', label: 'Thưởng', group: 'bonus', amount: round(num(e.bonus)), taxExempt: false });
  }

  const groups = Object.fromEntries(PAY_GROUPS.map((g) => [g, 0])) as Record<PayGroup, number>;
  for (const l of lines) groups[l.group] += l.amount;
  const gross = lines.reduce((s, l) => s + l.amount, 0);
  const taxExempt = lines.filter((l) => l.taxExempt).reduce((s, l) => s + l.amount, 0);
  const taxableIncome = Math.max(0, gross - taxExempt);

  const insuranceBase = num(employee.insuranceBase);
  const zero = insurance(0, settings.insurance.employee);
  const insuranceEmployee = insuranceBase > 0 ? insurance(insuranceBase, settings.insurance.employee) : zero;
  const insuranceCompany = insuranceBase > 0 ? insurance(insuranceBase, settings.insurance.company) : zero;

  let pit: Payslip['pit'];
  if (employee.contractType === 'hdld') {
    const deductions =
      settings.pit.personalDeduction +
      num(employee.dependents) * settings.pit.dependentDeduction +
      insuranceEmployee.total;
    const assessable = Math.max(0, taxableIncome - deductions);
    pit = { method: 'progressive', deductions, assessable, amount: round(progressiveTax(assessable, settings.pit.brackets)) };
  } else {
    const withheld = taxableIncome >= settings.pit.ctvThreshold ? taxableIncome * settings.pit.ctvRate : 0;
    pit = { method: 'withholding', deductions: 0, assessable: taxableIncome, amount: round(withheld) };
  }
  if (typeof e.pitOverride === 'number' && Number.isFinite(e.pitOverride)) {
    pit = { ...pit, amount: round(e.pitOverride), overridden: true };
  }

  const carryOver = round(num(e.carryOver));
  const advance = round(num(e.advance));
  const net = gross - insuranceEmployee.total - pit.amount + carryOver - advance;

  return {
    code: employee.code,
    fullName: employee.fullName,
    team: employee.team,
    contractType: employee.contractType,
    lines,
    groups,
    gross,
    taxExempt,
    taxableIncome,
    insuranceEmployee,
    insuranceCompany,
    pit,
    carryOver,
    advance,
    net,
  };
}

export type PayrollSummary = {
  headcount: number;
  gross: number;
  pit: number;
  insuranceEmployee: number;
  insuranceCompany: number;
  net: number;
  byTeam: { team: string; headcount: number; gross: number; net: number }[];
};

/** Headcount counts only people actually paid this period (gross > 0), like the TH LƯƠNG sheet. */
export function summarize(payslips: Payslip[]): PayrollSummary {
  const paid = payslips.filter((p) => p.gross > 0);
  const byTeam = new Map<string, { team: string; headcount: number; gross: number; net: number }>();
  for (const p of paid) {
    const t = byTeam.get(p.team) ?? { team: p.team, headcount: 0, gross: 0, net: 0 };
    t.headcount += 1;
    t.gross += p.gross;
    t.net += p.net;
    byTeam.set(p.team, t);
  }
  const sum = (f: (p: Payslip) => number) => paid.reduce((s, p) => s + f(p), 0);
  return {
    headcount: paid.length,
    gross: sum((p) => p.gross),
    pit: sum((p) => p.pit.amount),
    insuranceEmployee: sum((p) => p.insuranceEmployee.total),
    insuranceCompany: sum((p) => p.insuranceCompany.total),
    net: sum((p) => p.net),
    byTeam: [...byTeam.values()],
  };
}
