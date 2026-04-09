const mongoose = require('mongoose');

const collection =
  String(process.env.MONGODB_INVOICE_COLLECTION || 'invoice_clients').trim() ||
  'invoice_clients';

const invoiceClientSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true, index: true },
    buyerName: { type: String, default: '' },
    taxCode: { type: String, default: '' },
    phone: { type: String, default: '' },
    idNumber: { type: String, default: '' },
    address: { type: String, default: '' },
    businessLicense: { type: String, default: '' },
    operationName: { type: String, default: '' },
  },
  { collection }
);

module.exports = mongoose.model('InvoiceClient', invoiceClientSchema);
