/**
 * CLI: convert a local Excel file to invoiceData.json (same columns as API upload).
 * Usage: PANCAKE_EXCEL_PATH="C:/path/file.xlsx" node scripts/convertExcelToInvoiceData.js
 */
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const {
  parseExcelRows,
  saveInvoiceDataToDisk,
} = require('../invoiceExcel');

const excelPath =
  process.env.PANCAKE_EXCEL_PATH ||
  path.join(__dirname, '..', 'sample.xlsx');

if (!fs.existsSync(excelPath)) {
  console.error('Excel file not found:', excelPath);
  console.error('Set PANCAKE_EXCEL_PATH to your .xlsx path.');
  process.exit(1);
}

const wb = xlsx.readFile(excelPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

let data;
try {
  data = parseExcelRows(rows);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}

saveInvoiceDataToDisk(data);
console.log(`Wrote ${data.length} entries to invoiceData.json`);
