/**
 * Import invoiceData.json into MongoDB via Mongoose.
 *
 * PowerShell:
 *   $env:MONGO_URL="paste-from-railway"; npm run seed-mongo
 *
 * Or set MONGODB_URI in .env
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const mongoose = require('mongoose');
const { normalizeInvoiceRow } = require('../invoiceExcel');

const uri = String(
  process.env.MONGODB_URI || process.env.MONGO_URL || ''
).trim();
if (!uri) {
  console.error('Set MONGODB_URI or MONGO_URL (Railway Mongo plugin uses MONGO_URL).');
  process.exit(1);
}

const jsonPath = path.join(__dirname, '..', 'invoiceData.json');
if (!fs.existsSync(jsonPath)) {
  console.error('File not found:', jsonPath);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const rows = Array.isArray(raw) ? raw : [];

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const InvoiceClient = require('../models/InvoiceClient');
  await InvoiceClient.deleteMany({});
  const normalized = rows.map((r) => normalizeInvoiceRow(r || {}));
  if (normalized.length) {
    await InvoiceClient.insertMany(
      normalized.map((row, i) => ({ ...row, order: i }))
    );
  }
  await InvoiceClient.collection.createIndex({ order: 1 });
  console.log(
    `Seeded ${normalized.length} document(s) into collection "${InvoiceClient.collection.name}"`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
