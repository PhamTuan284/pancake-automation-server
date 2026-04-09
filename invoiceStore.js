const mongoose = require('mongoose');
const InvoiceClient = require('./models/InvoiceClient');
const {
  loadInvoiceDataNormalized,
  saveInvoiceDataToDisk,
  normalizeInvoiceRow,
} = require('./invoiceExcel');

/**
 * Railway’s MongoDB plugin usually exposes MONGO_URL.
 * You can also set MONGODB_URI in .env (Atlas, local, etc.).
 */
function mongoUri() {
  return String(
    process.env.MONGODB_URI || process.env.MONGO_URL || ''
  ).trim();
}

function useMongo() {
  return mongoUri().length > 0;
}

async function connectMongo() {
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

function docToRow(doc) {
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

async function loadNormalizedRows() {
  if (!useMongo()) {
    return loadInvoiceDataNormalized();
  }
  await connectMongo();
  const docs = await InvoiceClient.find().sort({ order: 1 }).lean();
  return docs.map(docToRow);
}

async function replaceAllRows(rows) {
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

async function ensureMongoConnected() {
  if (!useMongo()) return;
  await connectMongo();
}

module.exports = {
  useMongo,
  mongoUri,
  connectMongo,
  loadNormalizedRows,
  replaceAllRows,
  ensureMongoConnected,
  normalizeInvoiceRow,
};
