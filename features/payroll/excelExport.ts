import * as XLSX from 'xlsx';
import { metricLabel, type PayrollEmployee, type PayrollEntry } from './payroll.types';
import { emptyEntry } from './payroll.engine';
import { ENTRY_FIELDS, INPUT_SHEET } from './excelWorkbook';

/**
 * Employee list export and the reader for a filled-in "Số liệu nhập" sheet.
 * The month's payroll workbook itself is built by excelWorkbook.ts.
 */

export { INPUT_SHEET, metricColumns } from './excelWorkbook';

type Row = (string | number | null)[];

function sheet(rows: Row[], widths: number[], moneyFromCol = 0, headerRows = 1): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let r = headerRows; r <= range.e.r; r++) {
    for (let c = moneyFromCol; c <= range.e.c; c++) {
      const cellRef = ws[XLSX.utils.encode_cell({ r, c })];
      if (cellRef && cellRef.t === 'n') cellRef.z = '#,##0';
    }
  }
  return ws;
}

function componentSummary(e: PayrollEmployee): string {
  return e.components
    .map((c) => {
      switch (c.kind) {
        case 'qty_rate':
          return `${c.label}: ${c.rate.toLocaleString('vi-VN')}đ × ${metricLabel(c.metric)}${c.max ? ` (tối đa ${c.max.toLocaleString('vi-VN')}đ)` : ''}`;
        case 'fixed':
          return `${c.label}: ${c.amount.toLocaleString('vi-VN')}đ`;
        case 'percent':
          return `${c.label}: ${+(c.pct * 100).toFixed(4)}%${c.weight && c.weight !== 1 ? ` × ${+(c.weight * 100).toFixed(2)}%` : ''} ${metricLabel(c.metric)}${c.threshold ? ` (khi > ${c.threshold.toLocaleString('vi-VN')})` : ''}`;
        case 'kpi_base':
          return `${c.label}: ${c.baseAmount.toLocaleString('vi-VN')}đ cho ${c.includedQty} ${metricLabel(c.metric)}, vượt ${c.overRate.toLocaleString('vi-VN')}đ`;
        case 'live_hours':
          return `${c.label}: ${c.rate.toLocaleString('vi-VN')}đ/giờ${c.standardAmount ? `, tiêu chuẩn ${c.standardAmount.toLocaleString('vi-VN')}đ` : ''}`;
      }
    })
    .join('; ');
}

export function buildEmployeesWorkbook(employees: PayrollEmployee[]): Buffer {
  const rows: Row[] = [[
    'STT', 'Mã nhân viên', 'Họ và tên', 'Team', 'Vị trí công việc', 'Loại HĐ', 'Mức đóng BH', 'Mã số thuế',
    'CMT/CCCD', 'Số NPT', 'Tài khoản MeiT', 'Đang làm', 'Cách tính lương (ghi chú)', 'Công thức trong hệ thống',
  ]];
  employees.forEach((e, i) => {
    rows.push([
      i + 1, e.code, e.fullName, e.team, e.position, e.contractType === 'hdld' ? 'HĐLĐ' : 'CTV', e.insuranceBase,
      e.taxCode, e.idNumber, e.dependents, e.username, e.isActive ? 'x' : '', e.payNote, componentSummary(e),
    ]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rows, [5, 10, 24, 10, 22, 8, 12, 14, 14, 7, 14, 8, 40, 60], 6), 'Thông tin lao động');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Reads a filled-in "Số liệu nhập" sheet back into entries; null when the workbook has none. */
export function parseInputSheet(buffer: Buffer): PayrollEntry[] | null {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[INPUT_SHEET];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const keys = (rows[1] ?? []).map((k) => String(k ?? '').trim());
  if (keys[0] !== 'code') throw new Error(`Sheet "${INPUT_SHEET}" thiếu dòng mã cột (dòng 2) — hãy dùng file mẫu tải từ hệ thống.`);
  const entryKeys = new Set(ENTRY_FIELDS.map(([k]) => k as string));
  const entries: PayrollEntry[] = [];
  for (const row of rows.slice(2)) {
    const code = String(row[0] ?? '').trim().toUpperCase();
    if (!code) continue;
    const entry = emptyEntry(code);
    keys.forEach((key, i) => {
      if (i < 3 || !key) return;
      const raw = row[i];
      if (raw === undefined || raw === null || raw === '') return;
      if (key === 'note') {
        entry.note = String(raw);
        return;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${code}: cột "${key}" không phải số ("${String(raw)}").`);
      if (entryKeys.has(key)) (entry as unknown as Record<string, number>)[key] = value;
      else entry.metrics[key] = value;
    });
    entries.push(entry);
  }
  return entries;
}
