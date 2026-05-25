import { useMongo } from '../../common/mongo';
import type { InvoiceRow } from '../../common/types/invoice';
import type { InvoiceShopKey } from './invoiceShops';
import { getInvoiceShopConfig } from './invoiceShops';
import { listMeiTAutomationVariantsForPanel } from './meitAutomationVariants';
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

export function getShopPanelConfig(shopKey: InvoiceShopKey) {
  const shop = getInvoiceShopConfig(shopKey);
  return {
    shopKey: shop.key,
    label: shop.label,
    invoiceUrl: shop.invoiceUrl,
    mongoCollection: shop.mongoCollection,
    ...(shopKey === 'meit'
      ? {
          meitAutomationTargets: listMeiTAutomationVariantsForPanel().map((t) => ({
            variant: t.variant,
            label: t.label,
            shopId: t.pancakeShopId,
            invoiceUrl: t.invoiceUrl,
            configured: t.configured,
          })),
        }
      : {}),
  };
}

export async function listInvoiceClients(
  shopKey: InvoiceShopKey
): Promise<InvoiceRow[]> {
  return loadInvoiceClientsFromDb(shopKey);
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
  shopKey: InvoiceShopKey,
  normalized: InvoiceRow[]
): Promise<void> {
  await replaceAllRows(shopKey, normalized);
}

export function parseInvoiceExcelBuffer(buffer: Buffer): InvoiceRow[] {
  return parseExcelBuffer(buffer);
}

export function invoiceExcelTemplateBuffer(): Buffer {
  return buildInvoiceExcelTemplateBuffer();
}
