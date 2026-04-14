import { Before, Given, Then, When } from '@wdio/cucumber-framework';
import { browser, expect } from '@wdio/globals';
import type { InvoiceRow } from '../../../common/types/invoice';
import { loadNormalizedRows, useMongo } from '../../../features/pancake-einvoice/lib/invoiceStore';
import { loginToPancake } from '../../../features/pancake-einvoice/automation/pancakeLogin';
import { processInvoicesByBuyerName } from '../../../features/pancake-einvoice/automation/processInvoiceTable';

let loadedInvoiceRows: InvoiceRow[] = [];

Before(() => {
  loadedInvoiceRows = [];
});

Given('MongoDB is configured for invoice clients', () => {
  if (!useMongo()) {
    throw new Error(
      'MongoDB is not configured: set MONGODB_URI or MONGO_URL in .env'
    );
  }
});

When('I load invoice client rows from MongoDB', async () => {
  loadedInvoiceRows = await loadNormalizedRows();
});

When('I sign in to Pancake and open the e-invoices page', async () => {
  await loginToPancake(browser);
});

When(
  'I process pending e-invoice table rows using the loaded Mongo rows',
  async () => {
    await processInvoicesByBuyerName(browser, loadedInvoiceRows);
  }
);

Then('I should be on the Pancake e-invoices page', async () => {
  await expect(browser).toHaveUrl(expect.stringContaining('e-invoices'));
});
