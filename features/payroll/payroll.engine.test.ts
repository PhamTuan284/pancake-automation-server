import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computePayslip, progressiveTax, summarize } from './payroll.engine';
import { parsePayrollWorkbook, pctFromFormula } from './excelImport';
import { buildPayrollWorkbook } from './excelWorkbook';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollEmployee, type PayrollEntry } from './payroll.types';

/**
 * Golden test: every monthly workbook in docs/payrolls, imported and
 * recomputed by the engine, must reproduce the workbook's own gross / PIT /
 * net for every person. The engine rounds each line to the đồng, so allow a
 * couple of đồng.
 */

const WORKBOOK_DIR = path.resolve(__dirname, '../../../pancake-automation-ui/docs/payrolls');
const WORKBOOKS = fs.existsSync(WORKBOOK_DIR)
  ? fs.readdirSync(WORKBOOK_DIR).filter((n) => n.endsWith('.xlsx')).map((n) => path.join(WORKBOOK_DIR, n))
  : [];
const WORKBOOK_T10 = WORKBOOKS.find((f) => f.endsWith('_102026.xlsx'));
const TOLERANCE = 3;

const settings = DEFAULT_PAYROLL_SETTINGS;

function near(actual: number, expected: number, what: string) {
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${what}: app ${actual} ≠ Excel ${expected}`);
}

test('progressive PIT brackets', () => {
  assert.equal(progressiveTax(0, settings.pit.brackets), 0);
  assert.equal(progressiveTax(10_000_000, settings.pit.brackets), 500_000);
  assert.equal(progressiveTax(1_726_500, settings.pit.brackets), 86_325);
  assert.equal(progressiveTax(30_000_000, settings.pit.brackets), 2_500_000);
});

test('percent factors from formulas', () => {
  assert.deepEqual(pctFromFormula('AE9*1%*60%'), { pct: 0.01, weight: 0.6 });
  assert.deepEqual(pctFromFormula('K10*1.5%'), { pct: 0.015, weight: 1 });
  assert.deepEqual(pctFromFormula('IF(H8>500000000,H8*1%,0)'), { pct: 0.01, weight: 1 });
  assert.equal(pctFromFormula('M9*N9'), null);
});

test('live HĐLĐ: standard hours, night, Sunday, video (Đỗ Quốc Cường T10)', () => {
  const emp: PayrollEmployee = {
    code: 'CTV002',
    fullName: 'Đỗ Quốc Cường',
    team: 'Live',
    position: 'Live',
    contractType: 'hdld',
    insuranceBase: 5_700_000,
    taxCode: '',
    idNumber: '',
    dependents: 0,
    username: '',
    payNote: '',
    isActive: true,
    components: [
      { kind: 'live_hours', id: 'live', label: 'Lương livestream', rate: 150_000, standardAmount: 5_700_000 },
      { kind: 'qty_rate', id: 'video', label: 'Quay video', metric: 'videos', rate: 40_000, group: 'performance' },
    ],
  };
  const slip = computePayslip(
    emp,
    { code: 'CTV002', metrics: { liveHours: 111, nightHours: 1.5, sundayHours: 16, videos: 20 }, bonus: 0, advance: 0, carryOver: 0, note: '' },
    settings
  );
  assert.equal(slip.groups.position, 5_700_000);
  assert.equal(slip.gross, 18_117_500);
  assert.equal(slip.taxExempt, 292_500);
  assert.equal(slip.insuranceEmployee.total, 598_500);
  assert.equal(slip.insuranceCompany.total, 1_225_500);
  assert.equal(slip.pit.amount, 86_325);
  assert.equal(slip.net, 17_432_675);
});

test('CTV withholding only from 5tr', () => {
  const base: PayrollEmployee = {
    code: 'X',
    fullName: 'X',
    team: 'Live',
    position: '',
    contractType: 'ctv',
    insuranceBase: 0,
    taxCode: '',
    idNumber: '',
    dependents: 0,
    username: '',
    payNote: '',
    isActive: true,
    components: [{ kind: 'fixed', id: 'f', label: 'Phí', amount: 4_999_999, group: 'position' }],
  };
  assert.equal(computePayslip(base, undefined, settings).pit.amount, 0);
  base.components = [{ kind: 'fixed', id: 'f', label: 'Phí', amount: 5_000_000, group: 'position' }];
  assert.equal(computePayslip(base, undefined, settings).pit.amount, 500_000);
});


function employee(partial: Partial<PayrollEmployee>): PayrollEmployee {
  return {
    code: 'X',
    fullName: 'X',
    team: 'Sale',
    position: '',
    contractType: 'ctv',
    insuranceBase: 0,
    taxCode: '',
    idNumber: '',
    dependents: 0,
    username: '',
    payNote: '',
    isActive: true,
    components: [],
    ...partial,
  };
}

test('qty × rate cap: MIN(công × 219.231, 5.700.000)', () => {
  const emp = employee({
    components: [{ kind: 'qty_rate', id: 'cong', label: 'Lương theo công', metric: 'workDays', rate: 219_231, max: 5_700_000, group: 'position' }],
  });
  const at = (workDays: number) =>
    computePayslip(emp, { code: 'X', metrics: { workDays }, bonus: 0, advance: 0, carryOver: 0, note: '' }, settings).gross;
  assert.equal(at(26), 5_700_000);
  assert.equal(at(25), 5_480_775);
});

test('manual PIT override replaces the computed tax', () => {
  const emp = employee({ components: [{ kind: 'fixed', id: 'f', label: 'Phí', amount: 5_350_000, group: 'position' }] });
  const entry = { code: 'X', metrics: {}, bonus: 0, advance: 0, carryOver: 0, note: 'trả ngoài', pitOverride: 0 };
  const slip = computePayslip(emp, entry, settings);
  assert.equal(slip.pit.amount, 0);
  assert.equal(slip.pit.overridden, true);
  assert.equal(slip.net, 5_350_000);
  assert.equal(computePayslip(emp, { ...entry, pitOverride: null }, settings).pit.amount, 535_000);
});

for (const file of WORKBOOKS) {
  test(`${path.basename(file)} round-trips through importer + engine`, () => {
    const imported = parsePayrollWorkbook(fs.readFileSync(file));
    assert.ok(imported.month, 'month detected');
    assert.deepEqual(imported.warnings.filter((w) => w.startsWith('Bỏ qua')), []);

    const entries = new Map(imported.entries.map((e) => [e.code, e]));
    const payslips = imported.employees
      .filter((e) => e.isActive)
      .map((e) => computePayslip(e, entries.get(e.code), settings));

    for (const slip of payslips) {
      const exp = imported.expected[slip.code];
      assert.ok(exp, `${slip.code} has no Excel figures`);
      near(slip.gross, exp.gross, `${imported.month} ${slip.code} ${slip.fullName} tổng thu nhập`);
      near(slip.pit.amount, exp.tax, `${imported.month} ${slip.code} ${slip.fullName} thuế TNCN`);
      near(slip.net, exp.net, `${imported.month} ${slip.code} ${slip.fullName} thực lĩnh`);
    }
  });
}

test('10/2026 totals match the "TH LƯƠNG" dashboard sheet', { skip: !WORKBOOK_T10 && 'workbook not present' }, () => {
  const imported = parsePayrollWorkbook(fs.readFileSync(WORKBOOK_T10!));
  const entries = new Map(imported.entries.map((e) => [e.code, e]));
  const sum = summarize(
    imported.employees.filter((e) => e.isActive).map((e) => computePayslip(e, entries.get(e.code), settings))
  );
  assert.equal(sum.headcount, 23);
  assert.ok(Math.abs(sum.gross - 299_882_567) <= 30, `tổng quỹ lương ${sum.gross}`);
  assert.ok(Math.abs(sum.pit - 18_703_362) <= 30, `tổng thuế ${sum.pit}`);
  assert.equal(sum.insuranceEmployee, 4_273_500);
  assert.equal(sum.insuranceCompany, 8_750_500);
});

for (const file of WORKBOOKS) {
  test(`${path.basename(file)}: app export reads back to the same payslips`, async () => {
    const imported = parsePayrollWorkbook(fs.readFileSync(file));
    const entries = new Map(imported.entries.map((e) => [e.code, e]));
    const rows = imported.employees
      .filter((e) => e.isActive)
      .map((employee) => {
        const entry = entries.get(employee.code)!;
        return { employee, entry, payslip: computePayslip(employee, entry, settings) };
      });
    const exported = await buildPayrollWorkbook({ month: imported.month!, settings, rows });

    const back = parsePayrollWorkbook(exported);
    assert.equal(back.month, imported.month);
    assert.deepEqual(back.warnings.filter((w) => w.startsWith('Bỏ qua') || w.startsWith('Không thấy')), []);
    const backEntries = new Map(back.entries.map((e) => [e.code, e]));
    for (const { employee, payslip } of rows) {
      const exp = back.expected[employee.code];
      assert.ok(exp, `${employee.code} missing from export`);
      near(exp.gross, payslip.gross, `${imported.month} ${employee.code} file gross`);
      near(exp.net, payslip.net, `${imported.month} ${employee.code} file net`);
      const again = computePayslip(back.employees.find((e) => e.code === employee.code)!, backEntries.get(employee.code), settings);
      near(again.gross, payslip.gross, `${imported.month} ${employee.code} re-import gross`);
      near(again.pit.amount, payslip.pit.amount, `${imported.month} ${employee.code} re-import PIT`);
      near(again.net, payslip.net, `${imported.month} ${employee.code} re-import net`);
    }
  });
}

test('golden workbooks are present', () => {
  // Without this, a moved docs folder silently skips every golden test above.
  assert.ok(WORKBOOKS.length >= 1, `no workbooks found in ${WORKBOOK_DIR}`);
});

test('export puts off-layout components, bonus, advance and carry-over where totals still add up', async () => {
  const entry = (code: string, extra: Partial<PayrollEntry> = {}): PayrollEntry => ({
    code, metrics: {}, bonus: 0, advance: 0, carryOver: 0, note: '', ...extra,
  });
  const people: [PayrollEmployee, PayrollEntry][] = [
    [
      employee({
        code: 'M1', team: 'Media',
        components: [{ kind: 'kpi_base', id: 'kpi', label: 'KPI 80 video', metric: 'mediaVideoFull', baseAmount: 7_000_000, includedQty: 80, overRate: 80_000, group: 'position' }],
      }),
      entry('M1', { metrics: { mediaVideoFull: 95 }, bonus: 500_000, carryOver: -200_000, advance: 1_000_000 }),
    ],
    [
      employee({
        code: 'L1', team: 'Live', contractType: 'hdld', insuranceBase: 5_700_000,
        components: [
          { kind: 'live_hours', id: 'live', label: 'Live', rate: 150_000, standardAmount: 5_700_000 },
          { kind: 'fixed', id: 'phu-cap', label: 'Phụ cấp', amount: 1_000_000, group: 'performance' },
        ],
      }),
      entry('L1', { metrics: { liveHours: 120, nightHours: 4, sundayHours: 10 }, advance: 2_000_000 }),
    ],
    [
      employee({ code: 'X1', team: '', components: [{ kind: 'fixed', id: 'f', label: 'Phí', amount: 6_000_000, group: 'position' }] }),
      entry('X1', { pitOverride: 0, note: 'trả ngoài' }),
    ],
  ];
  const rows = people.map(([e, en]) => ({ employee: e, entry: en, payslip: computePayslip(e, en, settings) }));
  const back = parsePayrollWorkbook(await buildPayrollWorkbook({ month: '2026-11', settings, rows }));
  assert.equal(back.month, '2026-11');
  const backEntries = new Map(back.entries.map((e) => [e.code, e]));
  for (const { employee: e, payslip } of rows) {
    const exp = back.expected[e.code];
    assert.ok(exp, `${e.code} missing`);
    near(exp.gross, payslip.gross, `${e.code} file gross`);
    near(exp.net, payslip.net, `${e.code} file net`);
    const again = computePayslip(back.employees.find((x) => x.code === e.code)!, backEntries.get(e.code), settings);
    near(again.gross, payslip.gross, `${e.code} re-import gross`);
    near(again.net, payslip.net, `${e.code} re-import net`);
  }
  assert.equal(backEntries.get('X1')?.pitOverride, 0);
  assert.equal(backEntries.get('M1')?.advance, 1_000_000);
});
