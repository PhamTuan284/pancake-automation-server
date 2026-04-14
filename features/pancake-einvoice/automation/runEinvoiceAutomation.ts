import '../loadServerEnv';
import type { InvoiceRow } from '../../../common/types/invoice';
import { loadNormalizedRows } from '../lib/invoiceStore';
import { loginToPancake } from './pancakeLogin';
import { processInvoicesByBuyerName } from './processInvoiceTable';
import {
  connectPancakeBrowser,
  disposePancakeBrowserSession,
} from './pancakeBrowser';
import type { WdioBrowser } from './types';

/**
 * Core work shared by `POST /run-einvoice-automation` and WDIO E2E (same browser session as caller).
 */
export async function runEinvoiceAutomationWork(
  browser: WdioBrowser,
  invoiceRows: InvoiceRow[]
): Promise<void> {
  await loginToPancake(browser);
  await processInvoicesByBuyerName(browser, invoiceRows);
}

/**
 * Full server-side flow: Chrome → Pancake login → e-invoice table → fill rows from Mongo.
 * Used by API, `npm run automation`, and (via `runEinvoiceAutomationWork`) WDIO E2E.
 */
export async function runEinvoiceAutomation(): Promise<void> {
  const invoiceRows = await loadNormalizedRows();
  const session = await connectPancakeBrowser();

  try {
    try {
      await session.browser.maximizeWindow();
    } catch {
      /* some environments ignore maximize */
    }

    await runEinvoiceAutomationWork(session.browser, invoiceRows);

    console.log('E-invoice automation finished');
  } catch (err) {
    console.error('E-invoice automation error:', err);
    throw err;
  } finally {
    await disposePancakeBrowserSession(session);
  }
}
