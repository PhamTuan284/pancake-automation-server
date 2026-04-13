/**
 * Import a JSON file (array of invoice rows) into MongoDB.
 *
 * PowerShell:
 *   $env:MONGO_URL="..."; $env:PANCAKE_SEED_JSON="C:/path/rows.json"; npm run seed-mongo
 *
 * Or set MONGODB_URI in .env and PANCAKE_SEED_JSON for the JSON path.
 */
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import { normalizeInvoiceRow } from '../features/pancake-einvoice/lib/invoiceExcel';
import InvoiceClient from '../common/models/InvoiceClient';
import type { InvoiceRow } from '../common/types/invoice';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const uri = String(
  process.env.MONGODB_URI || process.env.MONGO_URL || ''
).trim();
if (!uri) {
  console.error('Set MONGODB_URI or MONGO_URL (Railway Mongo plugin uses MONGO_URL).');
  process.exit(1);
}

const jsonPath = String(
  process.env.PANCAKE_SEED_JSON || process.env.SEED_JSON_PATH || ''
).trim();
if (!jsonPath) {
  console.error(
    'Set PANCAKE_SEED_JSON (or SEED_JSON_PATH) to a JSON file containing an array of invoice rows.'
  );
  process.exit(1);
}

if (!fs.existsSync(jsonPath)) {
  console.error('File not found:', jsonPath);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as unknown;
const rows = Array.isArray(raw) ? raw : [];

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  await InvoiceClient.deleteMany({});
  const normalized = rows.map((r) =>
    normalizeInvoiceRow(r as Partial<InvoiceRow>)
  );
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
