import { useMongo } from '../../common/mongo';
import type { InvoiceRow } from '../../common/types/invoice';
import {
  parseExcelBuffer,
  normalizeInvoiceRow,
  buildInvoiceExcelTemplateBuffer,
} from './lib/invoiceExcel';
import {
  loadInvoiceClientsFromDb,
  replaceAllRows,
} from './lib/invoiceStore';

export function mongoEnabled(): boolean {
  return useMongo();
}

export async function listInvoiceClients(): Promise<InvoiceRow[]> {
  return loadInvoiceClientsFromDb();
}

export function normalizeInvoiceRowsFromPayload(
  rows: unknown[]
): InvoiceRow[] {
  return rows.map((r) => normalizeInvoiceRow(r as Partial<InvoiceRow>));
}

/** Throws Error with message per row index if validation fails. */
export function assertRowsHaveBuyerOrUnit(normalized: InvoiceRow[]): void {
  for (let i = 0; i < normalized.length; i++) {
    const r = normalized[i];
    if (!r.buyerName && !r.operationName) {
      throw new Error(
        `Dòng ${i + 1}: cần "Tên khách hàng" hoặc "Tên đơn vị".`
      );
    }
  }
}

export async function replaceInvoiceClients(
  normalized: InvoiceRow[]
): Promise<void> {
  await replaceAllRows(normalized);
}

export function parseInvoiceExcelBuffer(buffer: Buffer): InvoiceRow[] {
  return parseExcelBuffer(buffer);
}

export function invoiceExcelTemplateBuffer(): Buffer {
  return buildInvoiceExcelTemplateBuffer();
}
