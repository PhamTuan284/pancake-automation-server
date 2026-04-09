import mongoose from 'mongoose';
import InvoiceClient from './models/InvoiceClient';
import {
  loadInvoiceDataNormalized,
  saveInvoiceDataToDisk,
  normalizeInvoiceRow,
} from './invoiceExcel';
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

export async function loadNormalizedRows(): Promise<InvoiceRow[]> {
  if (!useMongo()) {
    return loadInvoiceDataNormalized();
  }
  await connectMongo();
  const docs = await InvoiceClient.find().sort({ order: 1 }).lean();
  return docs.map(docToRow);
}

export async function replaceAllRows(rows: InvoiceRow[]): Promise<void> {
  if (!useMongo()) {
    saveInvoiceDataToDisk(rows);
    return;
  }
  await connectMongo();
  const normalized = rows.map((r) => normalizeInvoiceRow(r || {}));
  await InvoiceClient.deleteMany({});
  if (normalized.length > 0) {
    await InvoiceClient.insertMany(
      normalized.map((row, i) => ({ ...row, order: i }))
    );
  }
}

export async function ensureMongoConnected(): Promise<void> {
  if (!useMongo()) return;
  await connectMongo();
}

export { normalizeInvoiceRow };
