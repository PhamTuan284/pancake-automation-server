/**
 * CLI: convert a local Excel file to invoiceData.json (same columns as API upload).
 * Usage: PANCAKE_EXCEL_PATH="C:/path/file.xlsx" npx tsx scripts/convertExcelToInvoiceData.ts
 */
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { parseExcelRows, saveInvoiceDataToDisk } from '../invoiceExcel';

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
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

let data;
try {
  data = parseExcelRows(rows);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
}

saveInvoiceDataToDisk(data);
console.log(`Wrote ${data.length} entries to invoiceData.json`);
