import { Then, When } from '@wdio/cucumber-framework';
import { browser, expect } from '@wdio/globals';
import PancakeLoginPage from '../pageobjects/pancake-login.page';

const pancakeLoginPage = new PancakeLoginPage();

When('I complete the Pancake login flow to e-invoices', async () => {
  await pancakeLoginPage.loginThroughToEInvoices();
});

Then('I should be on the e-invoices page', async () => {
  await expect(browser).toHaveUrl(expect.stringContaining('e-invoices'));
});
