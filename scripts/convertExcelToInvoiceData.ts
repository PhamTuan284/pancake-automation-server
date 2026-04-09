/**
 * CLI: Excel → JSON file (same columns as API upload).
 *
 * PowerShell:
 *   $env:PANCAKE_EXCEL_PATH="C:/path/file.xlsx"; $env:PANCAKE_OUTPUT_JSON="./out.json"; npx tsx scripts/convertExcelToInvoiceData.ts
 */
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { parseExcelRows } from '../invoiceExcel';

const excelPath =
  process.env.PANCAKE_EXCEL_PATH ||
  path.join(__dirname, '..', 'sample.xlsx');

const outPath = String(process.env.PANCAKE_OUTPUT_JSON || '').trim();
if (!outPath) {
  console.error(
    'Set PANCAKE_OUTPUT_JSON to the path for the output JSON array file.'
  );
  process.exit(1);
}

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

fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
console.log(`Wrote ${data.length} entries to ${outPath}`);
