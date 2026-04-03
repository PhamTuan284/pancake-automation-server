const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const file =
  process.env.PANCAKE_EXCEL_PATH ||
  'C:/Users/oomrn/Downloads/Khách hàng xuất hóa đơn DPA.xlsx';

if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(1);
}

const wb = xlsx.readFile(file);
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

console.log('Sheet:', sheetName);
console.log('Header row:', JSON.stringify(rows[0]));
console.log('First 5 data rows:');
console.log(JSON.stringify(rows.slice(1, 6), null, 2));

