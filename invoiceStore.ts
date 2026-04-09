import mongoose from 'mongoose';
import InvoiceClient from './models/InvoiceClient';
import { normalizeInvoiceRow } from './invoiceExcel';
import type { InvoiceRow } from './types/invoice';

/**
 * Railway’s MongoDB plugin usually exposes MONGO_URL.
 * You can also set MONGODB_URI in .env (Atlas, local, etc.).
 */
export function mongoUri(): string {
  return String(
    process.env.MONGODB_URI || process.env.MONGO_URL || ''
  ).trim();
}

export function useMongo(): boolean {
  return mongoUri().length > 0;
}

export async function connectMongo(): Promise<void> {
  if (!useMongo()) {
    throw new Error('No MONGODB_URI or MONGO_URL');
  }
  if (mongoose.connection.readyState === 1) {
    return;
  }
  await mongoose.connect(mongoUri(), {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });
}

function docToRow(doc: {
  buyerName?: string;
  taxCode?: string;
  phone?: string;
  idNumber?: string;
  address?: string;
  businessLicense?: string;
  operationName?: string;
}): InvoiceRow {
  return normalizeInvoiceRow({
    buyerName: doc.buyerName,
    taxCode: doc.taxCode,
    phone: doc.phone,
    idNumber: doc.idNumber,
    address: doc.address,
    businessLicense: doc.businessLicense,
    operationName: doc.operationName,
  });
}

async function loadRowsFromMongo(): Promise<InvoiceRow[]> {
  await connectMongo();
  const docs = await InvoiceClient.find().sort({ order: 1 }).lean();
  return docs.map(docToRow);
}

/**
 * Read invoice rows from MongoDB `invoice_clients` only (for API table/UI).
 * Caller should check `useMongo()` first or handle missing URI.
 */
export async function loadInvoiceClientsFromDb(): Promise<InvoiceRow[]> {
  return loadRowsFromMongo();
}

/** Invoice rows from MongoDB only (automation, same as API). */
export async function loadNormalizedRows(): Promise<InvoiceRow[]> {
  if (!useMongo()) {
    throw new Error(
      'Invoice data requires MongoDB: set MONGODB_URI or MONGO_URL in .env'
    );
  }
  return loadRowsFromMongo();
}

/** Replace `invoice_clients` from rows (Mongo only; caller must ensure URI is set). */
export async function replaceInvoiceClientsInMongo(
  rows: InvoiceRow[]
): Promise<void> {
  await connectMongo();
  const normalized = rows.map((r) => normalizeInvoiceRow(r || {}));
  await InvoiceClient.deleteMany({});
  if (normalized.length > 0) {
    await InvoiceClient.insertMany(
      normalized.map((row, i) => ({ ...row, order: i }))
    );
  }
  await InvoiceClient.collection.createIndex({ order: 1 });
}

export async function replaceAllRows(rows: InvoiceRow[]): Promise<void> {
  if (!useMongo()) {
    throw new Error(
      'Persisting invoice rows requires MongoDB: set MONGODB_URI or MONGO_URL'
    );
  }
  await replaceInvoiceClientsInMongo(rows);
}

export async function ensureMongoConnected(): Promise<void> {
  if (!useMongo()) return;
  await connectMongo();
}

export { normalizeInvoiceRow };
