import type { InvoiceShopKey } from '../invoiceShops';
import { getInvoiceClientModel } from '../../../common/models/invoiceClientModel';
import { connectMongo, useMongo } from '../../../common/mongo';
import { normalizeInvoiceRow } from './invoiceExcel';
import type { InvoiceRow } from '../../../common/types/invoice';

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

async function loadRowsFromMongo(shopKey: InvoiceShopKey): Promise<InvoiceRow[]> {
  await connectMongo();
  const InvoiceClient = getInvoiceClientModel(shopKey);
  const docs = await InvoiceClient.find().sort({ order: 1 }).lean();
  return docs.map(docToRow);
}

export async function loadInvoiceClientsFromDb(
  shopKey: InvoiceShopKey
): Promise<InvoiceRow[]> {
  return loadRowsFromMongo(shopKey);
}

export async function loadNormalizedRows(
  shopKey: InvoiceShopKey
): Promise<InvoiceRow[]> {
  if (!useMongo()) {
    throw new Error(
      'Invoice data requires MongoDB: set MONGODB_URI or MONGO_URL in .env'
    );
  }
  return loadRowsFromMongo(shopKey);
}

export async function replaceInvoiceClientsInMongo(
  shopKey: InvoiceShopKey,
  rows: InvoiceRow[]
): Promise<void> {
  await connectMongo();
  const InvoiceClient = getInvoiceClientModel(shopKey);
  const normalized = rows.map((r) => normalizeInvoiceRow(r || {}));
  await InvoiceClient.deleteMany({});
  if (normalized.length > 0) {
    await InvoiceClient.insertMany(
      normalized.map((row, i) => ({ ...row, order: i }))
    );
  }
  await InvoiceClient.collection.createIndex({ order: 1 });
}

export async function replaceAllRows(
  shopKey: InvoiceShopKey,
  rows: InvoiceRow[]
): Promise<void> {
  if (!useMongo()) {
    throw new Error(
      'Persisting invoice rows requires MongoDB: set MONGODB_URI or MONGO_URL'
    );
  }
  await replaceInvoiceClientsInMongo(shopKey, rows);
}

export { useMongo, normalizeInvoiceRow };
