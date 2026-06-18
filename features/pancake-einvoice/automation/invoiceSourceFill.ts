import type { InvoiceRow } from '../../../common/types/invoice';
import { findByBuyerName, findByPhone } from './invoiceRowMatch';

export const BUYER_FACEBOOK_NO_INVOICE =
  'Người mua Facebook không cung cấp thông tin';
export const BUYER_ZALO_NO_INVOICE = 'Người mua Zalo không cung cấp thông tin';

function localeLower(s: string): string {
  try {
    return s.toLocaleLowerCase('vi-VN');
  } catch {
    return s.toLowerCase();
  }
}

/**
 * Nguồn đơn = "MeiT Việt Nam", "CTV / MEIT GRACE", or "Facebook".
 * Row `getText()` contains the full table row text including nguồn đơn.
 */
export function rowHasFacebookOrderSource(rowText: string): boolean {
  const t = localeLower(rowText);
  return (
    t.includes('meit việt nam') ||
    t.includes('meit grace') ||
    t.includes('facebook')
  );
}

/** Nguồn đơn includes "Zalo" (any casing). */
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
 * MeiT tab fill priority:
 * 1. Customer list match (by phone or buyer name) → use stored data.
 * 2. No match + Facebook nguồn đơn → placeholder "Người mua Facebook…".
 * 3. No match + Zalo nguồn đơn → placeholder "Người mua Zalo…".
 * 4. No match + unknown source → null (skip row).
 *
 * Other shops: customer list match only.
 */
export function resolveInvoiceFillData(
  rowText: string,
  invoiceRows: InvoiceRow[],
  options: { meitSourceRules: boolean }
): InvoiceRow | null {
  const matched = matchCustomerRow(invoiceRows, rowText);
  if (matched) return matched;

  if (options.meitSourceRules) {
    if (rowHasFacebookOrderSource(rowText)) {
      return emptyInvoiceRow(BUYER_FACEBOOK_NO_INVOICE);
    }
    if (rowHasZaloOrderSource(rowText)) {
      return emptyInvoiceRow(BUYER_ZALO_NO_INVOICE);
    }
  }

  return null;
}
