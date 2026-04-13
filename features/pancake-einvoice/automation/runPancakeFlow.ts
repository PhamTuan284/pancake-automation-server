import path from 'path';
import dotenv from 'dotenv';
import { remote } from 'webdriverio';
import type { ChildProcess } from 'child_process';
import { loadNormalizedRows } from '../lib/invoiceStore';
import type { WdioBrowser } from './types';
import { startChromeDriver } from './chromeDriver';
import { loginToPancake } from './pancakeLogin';
import { processInvoicesByBuyerName } from './processInvoiceTable';

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

export async function runPancakeFlow() {
  const invoiceRows = await loadNormalizedRows();
  let driverChild: ChildProcess | null = null;

  const { port, child } = await startChromeDriver();
  driverChild = child;

  let browser: WdioBrowser | undefined;
  try {
    browser = await remote({
      hostname: 'localhost',
      port,
      path: '/',
      capabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: [
            '--start-maximized',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--no-first-run',
            '--incognito',
          ],
        },
      },
      connectionRetryCount: 1,
      connectionRetryTimeout: 15000,
    });

    try {
      await browser.maximizeWindow();
    } catch {
      /* some environments ignore maximize */
    }

    await loginToPancake(browser);

    await processInvoicesByBuyerName(browser, invoiceRows);

    console.log('Automation run finished');
  } catch (err) {
    console.error('Automation error:', err);
    throw err;
  } finally {
    if (browser) {
      try {
        await browser.deleteSession();
      } catch {
        /* ignore */
      }
    }
    if (driverChild) {
      try {
        driverChild.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
