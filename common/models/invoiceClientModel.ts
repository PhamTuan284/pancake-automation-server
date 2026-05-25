import mongoose from 'mongoose';
import type { InvoiceShopKey } from '../../features/pancake-einvoice/invoiceShops';
import { getInvoiceShopConfig } from '../../features/pancake-einvoice/invoiceShops';

export type InvoiceClientDoc = {
  order: number;
  buyerName: string;
  taxCode: string;
  phone: string;
  idNumber: string;
  address: string;
  businessLicense: string;
  operationName: string;
};

const invoiceClientSchema = new mongoose.Schema<InvoiceClientDoc>(
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
  { collection: 'invoice_clients' }
);

const modelsByCollection = new Map<
  string,
  mongoose.Model<InvoiceClientDoc>
>();

export function getInvoiceClientModel(
  shopKey: InvoiceShopKey
): mongoose.Model<InvoiceClientDoc> {
  const collection = getInvoiceShopConfig(shopKey).mongoCollection;
  let model = modelsByCollection.get(collection);
  if (!model) {
    model = mongoose.model<InvoiceClientDoc>(
      `InvoiceClient_${collection}`,
      invoiceClientSchema,
      collection
    );
    modelsByCollection.set(collection, model);
  }
  return model;
}
