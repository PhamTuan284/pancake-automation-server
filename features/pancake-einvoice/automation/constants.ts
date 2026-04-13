import path from 'path';

export const INVOICE_URL =
  'https://pos.pancake.vn/shop/1942925579/e-invoices';

/** Marketing home; optional override PANCAKE_POS_HOME_URL */
export const POS_HOME_URL = 'https://pos.pancake.vn/';

/** Successful POS login lands here; `getUrl()` may include query/hash. */
export const POS_DASHBOARD_URL_SNIPPET = 'pos.pancake.vn/dashboard';

/** Persists filled row keys at server package root (next to `index.ts`). */
export const FILLED_INVOICES_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'filledInvoices.json'
);
