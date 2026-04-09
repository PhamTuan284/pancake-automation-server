/** One customer row (Excel / JSON / Mongo). */
export interface InvoiceRow {
  buyerName: string;
  taxCode: string;
  phone: string;
  idNumber: string;
  address: string;
  businessLicense: string;
  operationName: string;
}
