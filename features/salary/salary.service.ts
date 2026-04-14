type SalaryInput = {
  employeeName?: string;
  baseSalary: number;
  workDays: number;
  standardWorkDays: number;
  overtimeWeekdayHours: number;
  overtimeWeekendHours: number;
  overtimeHolidayHours: number;
  allowance: number;
  bonus: number;
  otherAddition: number;
  latePenalty: number;
  otherDeduction: number;
  advancePayment: number;
  insuranceRate: number;
  personalDeduction: number;
  dependentCount: number;
  dependentDeductionPerPerson: number;
};

type SalaryCalcBreakdown = {
  employeeName: string;
  baseSalary: number;
  proratedSalary: number;
  overtimePay: number;
  overtimePayWeekday: number;
  overtimePayWeekend: number;
  overtimePayHoliday: number;
  allowance: number;
  bonus: number;
  otherAddition: number;
  grossIncome: number;
  insuranceDeduction: number;
  taxableIncome: number;
  pitTax: number;
  latePenalty: number;
  otherDeduction: number;
  advancePayment: number;
  totalDeduction: number;
  netIncome: number;
};

const DEFAULTS: SalaryInput = {
  employeeName: '',
  baseSalary: 0,
  workDays: 26,
  standardWorkDays: 26,
  overtimeWeekdayHours: 0,
  overtimeWeekendHours: 0,
  overtimeHolidayHours: 0,
  allowance: 0,
  bonus: 0,
  otherAddition: 0,
  latePenalty: 0,
  otherDeduction: 0,
  advancePayment: 0,
  insuranceRate: 0.105,
  personalDeduction: 11_000_000,
  dependentCount: 0,
  dependentDeductionPerPerson: 4_400_000,
};

const PIT_BRACKETS = [
  { cap: 5_000_000, rate: 0.05 },
  { cap: 10_000_000, rate: 0.1 },
  { cap: 18_000_000, rate: 0.15 },
  { cap: 32_000_000, rate: 0.2 },
  { cap: 52_000_000, rate: 0.25 },
  { cap: 80_000_000, rate: 0.3 },
  { cap: Number.POSITIVE_INFINITY, rate: 0.35 },
] as const;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeInput(raw: Record<string, unknown>): SalaryInput {
  return {
    employeeName: String(raw.employeeName ?? DEFAULTS.employeeName).trim(),
    baseSalary: Math.max(0, toNumber(raw.baseSalary, DEFAULTS.baseSalary)),
    workDays: Math.max(0, toNumber(raw.workDays, DEFAULTS.workDays)),
    standardWorkDays: Math.max(
      1,
      toNumber(raw.standardWorkDays, DEFAULTS.standardWorkDays)
    ),
    overtimeWeekdayHours: Math.max(
      0,
      toNumber(raw.overtimeWeekdayHours, DEFAULTS.overtimeWeekdayHours)
    ),
    overtimeWeekendHours: Math.max(
      0,
      toNumber(raw.overtimeWeekendHours, DEFAULTS.overtimeWeekendHours)
    ),
    overtimeHolidayHours: Math.max(
      0,
      toNumber(raw.overtimeHolidayHours, DEFAULTS.overtimeHolidayHours)
    ),
    allowance: Math.max(0, toNumber(raw.allowance, DEFAULTS.allowance)),
    bonus: Math.max(0, toNumber(raw.bonus, DEFAULTS.bonus)),
    otherAddition: Math.max(
      0,
      toNumber(raw.otherAddition, DEFAULTS.otherAddition)
    ),
    latePenalty: Math.max(0, toNumber(raw.latePenalty, DEFAULTS.latePenalty)),
    otherDeduction: Math.max(
      0,
      toNumber(raw.otherDeduction, DEFAULTS.otherDeduction)
    ),
    advancePayment: Math.max(
      0,
      toNumber(raw.advancePayment, DEFAULTS.advancePayment)
    ),
    insuranceRate: Math.max(
      0,
      Math.min(1, toNumber(raw.insuranceRate, DEFAULTS.insuranceRate))
    ),
    personalDeduction: Math.max(
      0,
      toNumber(raw.personalDeduction, DEFAULTS.personalDeduction)
    ),
    dependentCount: Math.max(
      0,
      Math.floor(toNumber(raw.dependentCount, DEFAULTS.dependentCount))
    ),
    dependentDeductionPerPerson: Math.max(
      0,
      toNumber(
        raw.dependentDeductionPerPerson,
        DEFAULTS.dependentDeductionPerPerson
      )
    ),
  };
}

function roundMoney(value: number): number {
  return Math.round(value);
}

function calcProgressivePit(taxableIncome: number): number {
  let remain = Math.max(0, taxableIncome);
  let prevCap = 0;
  let tax = 0;
  for (const bracket of PIT_BRACKETS) {
    if (remain <= 0) break;
    const slab = Math.min(remain, bracket.cap - prevCap);
    if (slab > 0) {
      tax += slab * bracket.rate;
      remain -= slab;
    }
    prevCap = bracket.cap;
  }
  return tax;
}

export function calculateSalary(raw: Record<string, unknown>): SalaryCalcBreakdown {
  const input = normalizeInput(raw);
  const workRatio = Math.min(input.workDays / input.standardWorkDays, 1);
  const proratedSalary = input.baseSalary * workRatio;
  const hourlyRate = input.baseSalary / input.standardWorkDays / 8;

  const overtimePayWeekday = input.overtimeWeekdayHours * hourlyRate * 1.5;
  const overtimePayWeekend = input.overtimeWeekendHours * hourlyRate * 2;
  const overtimePayHoliday = input.overtimeHolidayHours * hourlyRate * 3;
  const overtimePay =
    overtimePayWeekday + overtimePayWeekend + overtimePayHoliday;

  const grossIncome =
    proratedSalary +
    overtimePay +
    input.allowance +
    input.bonus +
    input.otherAddition;
  const insuranceDeduction = grossIncome * input.insuranceRate;
  const dependentDeduction =
    input.dependentCount * input.dependentDeductionPerPerson;
  const taxableIncome = Math.max(
    0,
    grossIncome - insuranceDeduction - input.personalDeduction - dependentDeduction
  );
  const pitTax = calcProgressivePit(taxableIncome);
  const totalDeduction =
    insuranceDeduction +
    pitTax +
    input.latePenalty +
    input.otherDeduction +
    input.advancePayment;
  const netIncome = Math.max(0, grossIncome - totalDeduction);

  return {
    employeeName: input.employeeName || 'Nhân viên',
    baseSalary: roundMoney(input.baseSalary),
    proratedSalary: roundMoney(proratedSalary),
    overtimePay: roundMoney(overtimePay),
    overtimePayWeekday: roundMoney(overtimePayWeekday),
    overtimePayWeekend: roundMoney(overtimePayWeekend),
    overtimePayHoliday: roundMoney(overtimePayHoliday),
    allowance: roundMoney(input.allowance),
    bonus: roundMoney(input.bonus),
    otherAddition: roundMoney(input.otherAddition),
    grossIncome: roundMoney(grossIncome),
    insuranceDeduction: roundMoney(insuranceDeduction),
    taxableIncome: roundMoney(taxableIncome),
    pitTax: roundMoney(pitTax),
    latePenalty: roundMoney(input.latePenalty),
    otherDeduction: roundMoney(input.otherDeduction),
    advancePayment: roundMoney(input.advancePayment),
    totalDeduction: roundMoney(totalDeduction),
    netIncome: roundMoney(netIncome),
  };
}

export function getSalaryDefaults(): SalaryInput {
  return { ...DEFAULTS };
}
