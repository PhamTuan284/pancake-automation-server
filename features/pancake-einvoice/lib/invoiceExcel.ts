import xlsx from 'xlsx';
import type { InvoiceRow } from '../../../common/types/invoice';

/** Excel column titles → JSON keys (first sheet, row 1). */
const EXCEL_HEADERS = {
  buyerName: 'Tên khách hàng',
  taxCode: 'Mã số thuế',
  phone: 'Số điện thoại',
  idNumber: 'Số CCCD',
  address: 'Địa chỉ',
  businessLicense: 'Giấy phép kinh doanh',
  operationName: 'Tên đơn vị',
} as const;

type HeaderKey = keyof typeof EXCEL_HEADERS;

function trimStr(v: unknown): string {
  if (v == null || v === '') return '';
  const s =
    typeof v === 'number' && !Number.isNaN(v) ? String(v) : String(v);
  return s.replace(/^\uFEFF/, '').trim();
}

function buildHeaderIndex(headerRow: unknown[]): Partial<Record<HeaderKey, number>> {
  const idx: Partial<Record<HeaderKey, number>> = {};
  if (!headerRow || !Array.isArray(headerRow)) {
    return idx;
  }
  const normalized = headerRow.map((h) => trimStr(h));
  for (const [key, label] of Object.entries(EXCEL_HEADERS) as [
    HeaderKey,
    string,
  ][]) {
    idx[key] = normalized.indexOf(label);
  }
  return idx;
}

function cell(row: unknown[], colIndex: number): string {
  if (colIndex < 0 || !row) return '';
  const v = row[colIndex];
  return trimStr(v);
}

export function parseExcelRows(rows: unknown[][]): InvoiceRow[] {
  if (!rows || rows.length === 0) {
    return [];
  }
  const idx = buildHeaderIndex(rows[0]);
  const found = Object.values(idx).filter((i) => i >= 0);
  if (found.length === 0) {
    throw new Error(
      'Không tìm thấy tiêu đề cột. Cần một dòng đầu gồm: ' +
        Object.values(EXCEL_HEADERS).join(', ')
    );
  }

  const out: InvoiceRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || !row.length) continue;
    const buyerName = cell(row, idx.buyerName ?? -1);
    const operationName = cell(row, idx.operationName ?? -1);
    if (!buyerName && !operationName) continue;

    out.push({
      buyerName,
      taxCode: cell(row, idx.taxCode ?? -1),
      phone: cell(row, idx.phone ?? -1),
      idNumber: cell(row, idx.idNumber ?? -1),
      address: cell(row, idx.address ?? -1),
      businessLicense: cell(row, idx.businessLicense ?? -1),
      operationName,
    });
  }
  return out;
}

export function parseExcelBuffer(buffer: Buffer): InvoiceRow[] {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
  }) as unknown[][];
  return parseExcelRows(rows);
}

/** Normalize one row so UI / API always sees every key. */
export function normalizeInvoiceRow(r: Partial<InvoiceRow> | null | undefined): InvoiceRow {
  return {
    buyerName: trimStr(r?.buyerName),
    taxCode: trimStr(r?.taxCode),
    phone: trimStr(r?.phone),
    idNumber: trimStr(r?.idNumber),
    address: trimStr(r?.address),
    businessLicense: trimStr(r?.businessLicense),
    operationName: trimStr(r?.operationName),
  };
}

/** One-sheet .xlsx with row 1 = expected Vietnamese column titles (upload parser). */
export function buildInvoiceExcelTemplateBuffer(): Buffer {
  const headerRow = Object.values(EXCEL_HEADERS) as string[];
  const ws = xlsx.utils.aoa_to_sheet([headerRow]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
}
