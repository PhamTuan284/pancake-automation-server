import type { InvoiceRow } from '../../../common/types/invoice';
import { findByBuyerName, findByPhone } from './invoiceRowMatch';

export const BUYER_FACEBOOK_NO_INVOICE =
  'Người mua Facebook không lấy hóa đơn';
export const BUYER_ZALO_NO_INVOICE = 'Người mua Zalo không lấy hóa đơn';

function localeLower(s: string): string {
  try {
    return s.toLocaleLowerCase('vi-VN');
  } catch {
    return s.toLowerCase();
  }
}

/** Row `getText()` includes Nguồn đơn such as MeiT Mode or CTV. */
export function rowHasFacebookOrderSource(rowText: string): boolean {
  const t = localeLower(rowText);
  return t.includes('meit mode') || /\bctv\b/.test(t);
}

export function rowHasZaloOrderSource(rowText: string): boolean {
  return localeLower(rowText).includes('zalo');
}

function emptyInvoiceRow(buyerName: string): InvoiceRow {
  return {
    buyerName,
    taxCode: '',
    phone: '',
    idNumber: '',
    address: '',
    businessLicense: '',
    operationName: '',
  };
}

function matchCustomerRow(
  invoiceRows: InvoiceRow[],
  rowText: string
): InvoiceRow | null {
  const phoneMatch = rowText.match(/\d{9,11}/);
  if (phoneMatch) {
    const byPhone = findByPhone(invoiceRows, phoneMatch[0]);
    if (byPhone) return byPhone;
  }
  return findByBuyerName(invoiceRows, rowText);
}

/**
 * MeiT tab: fill rules from Nguồn đơn + customer list.
 * Other shops: match list only (legacy).
 */
export function resolveInvoiceFillData(
  rowText: string,
  invoiceRows: InvoiceRow[],
  options: { meitSourceRules: boolean }
): InvoiceRow | null {
  if (options.meitSourceRules && rowHasFacebookOrderSource(rowText)) {
    return emptyInvoiceRow(BUYER_FACEBOOK_NO_INVOICE);
  }

  const matched = matchCustomerRow(invoiceRows, rowText);
  if (options.meitSourceRules && rowHasZaloOrderSource(rowText)) {
    if (matched) {
      return matched;
    }
    return emptyInvoiceRow(BUYER_ZALO_NO_INVOICE);
  }

  return matched;
}
