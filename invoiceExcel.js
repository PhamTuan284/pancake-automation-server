const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const INVOICE_DATA_PATH = path.join(__dirname, 'invoiceData.json');

/** Excel column titles → JSON keys (first sheet, row 1). */
const EXCEL_HEADERS = {
  buyerName: 'Tên khách hàng',
  taxCode: 'Mã số thuế',
  phone: 'Số điện thoại',
  idNumber: 'Số CCCD',
  address: 'Địa chỉ',
  businessLicense: 'Giấy phép kinh doanh',
  operationName: 'Tên đơn vị',
};

function trimStr(v) {
  if (v == null || v === '') return '';
  const s =
    typeof v === 'number' && !Number.isNaN(v) ? String(v) : String(v);
  return s.replace(/^\uFEFF/, '').trim();
}

function buildHeaderIndex(headerRow) {
  const idx = {};
  if (!headerRow || !Array.isArray(headerRow)) {
    return idx;
  }
  const normalized = headerRow.map((h) => trimStr(h));
  for (const [key, label] of Object.entries(EXCEL_HEADERS)) {
    idx[key] = normalized.indexOf(label);
  }
  return idx;
}

function cell(row, colIndex) {
  if (colIndex < 0 || !row) return '';
  const v = row[colIndex];
  return trimStr(v);
}

/**
 * @param {any[][]} rows - First row = headers (from sheet_to_json header: 1)
 */
function parseExcelRows(rows) {
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

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const buyerName = cell(row, idx.buyerName);
    const operationName = cell(row, idx.operationName);
    if (!buyerName && !operationName) continue;

    out.push({
      buyerName,
      taxCode: cell(row, idx.taxCode),
      phone: cell(row, idx.phone),
      idNumber: cell(row, idx.idNumber),
      address: cell(row, idx.address),
      businessLicense: cell(row, idx.businessLicense),
      operationName,
    });
  }
  return out;
}

function parseExcelBuffer(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return parseExcelRows(rows);
}

function loadInvoiceDataFromDisk() {
  if (!fs.existsSync(INVOICE_DATA_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(INVOICE_DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [];
}

function saveInvoiceDataToDisk(data) {
  fs.writeFileSync(
    INVOICE_DATA_PATH,
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

/** Normalize one row so UI / older code always sees every key. */
function normalizeInvoiceRow(r) {
  return {
    buyerName: trimStr(r.buyerName),
    taxCode: trimStr(r.taxCode),
    phone: trimStr(r.phone),
    idNumber: trimStr(r.idNumber),
    address: trimStr(r.address),
    businessLicense: trimStr(r.businessLicense),
    operationName: trimStr(r.operationName),
  };
}

function loadInvoiceDataNormalized() {
  return loadInvoiceDataFromDisk().map(normalizeInvoiceRow);
}

module.exports = {
  parseExcelBuffer,
  parseExcelRows,
  saveInvoiceDataToDisk,
  loadInvoiceDataNormalized,
  normalizeInvoiceRow,
};
