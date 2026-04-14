import { Then, When } from '@wdio/cucumber-framework';
import { browser, expect } from '@wdio/globals';
import type { WdioBrowser } from '../../../features/pancake-einvoice/automation/types';
import { loadNormalizedRows } from '../../../features/pancake-einvoice/lib/invoiceStore';
import { runEinvoiceAutomationWork } from '../../../features/pancake-einvoice/automation/runEinvoiceAutomation';

When('I run the Pancake e-invoice automation', async () => {
  const rows = await loadNormalizedRows();
  await runEinvoiceAutomationWork(browser as WdioBrowser, rows);
});

Then('I should be on the e-invoices page', async () => {
  await expect(browser).toHaveUrl(expect.stringContaining('e-invoices'));
});
