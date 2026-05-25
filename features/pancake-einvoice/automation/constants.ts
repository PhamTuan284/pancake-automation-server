import { getActiveAutomationConfig } from '../invoiceShops';

export function getInvoiceUrl(): string {
  return getActiveAutomationConfig().invoiceUrl;
}

/** @deprecated Use getInvoiceUrl() — resolved from PANCAKE_ACTIVE_INVOICE_SHOP */
export const INVOICE_URL = 'https://pos.pancake.vn/shop/1942925579/e-invoices';

/** Marketing home; optional override PANCAKE_POS_HOME_URL */
export const POS_HOME_URL = 'https://pos.pancake.vn/';

/** Successful POS login lands here; `getUrl()` may include query/hash. */
export const POS_DASHBOARD_URL_SNIPPET = 'pos.pancake.vn/dashboard';

export function getFilledInvoicesStorageKey(): string {
  return getActiveAutomationConfig().filledInvoicesStorageKey;
}

/** @deprecated Use getFilledInvoicesStorageKey() */
export const FILLED_INVOICES_STORAGE_KEY = 'pancake.einvoice.filledRows';
