/**
 * Quick MongoDB connectivity check (same URI order as the API: MONGODB_URI, then MONGO_URL).
 *
 * Optional one-off: TEST_MONGO_URI=mongodb://... npm run test-mongo
 *
 * PowerShell:
 *   npm run test-mongo
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const uri = String(
  process.env.TEST_MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URL ||
    process.env.MONGO_PUBLIC_URL ||
    process.env.SEED_MONGO_URI ||
    ''
).trim();

if (!uri) {
  console.error(
    'No URI found. Set one of: MONGODB_URI, MONGO_URL, MONGO_PUBLIC_URL, SEED_MONGO_URI, or TEST_MONGO_URI'
  );
  process.exit(1);
}

if (uri.includes('.railway.internal') && !process.env.RAILWAY_ENVIRONMENT) {
  console.warn(
    'Note: *.railway.internal usually only works on Railway or via `railway run`, not from your PC.\n'
  );
}

async function main() {
  const redacted = uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  console.log('Connecting to', redacted);

  await mongoose.connect(uri, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 15000,
  });

  const admin = mongoose.connection.db.admin();
  const ping = await admin.command({ ping: 1 });
  console.log('Ping:', ping.ok === 1 ? 'OK' : ping);

  const dbName = mongoose.connection.db.databaseName;
  console.log('Database:', dbName);

  try {
    const InvoiceClient = require('../models/InvoiceClient');
    const n = await InvoiceClient.countDocuments();
    console.log(`Collection "${InvoiceClient.collection.name}": ${n} document(s)`);
  } catch (e) {
    console.log('(Could not count invoice_clients:', e.message + ')');
  }

  await mongoose.disconnect();
  console.log('Disconnected. Connection test passed.');
}

main().catch((err) => {
  console.error('Connection failed:', err.message || err);
  process.exit(1);
});
