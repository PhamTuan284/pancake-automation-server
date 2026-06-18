import type { InvoiceRow } from '../../../common/types/invoice';
import type { WdioBrowser, WdioElement } from './types';
import { getInvoiceUrl } from './constants';
import { SEL } from './xpathInvoiceUi';
import {
  loadFilledInvoiceKeys,
  persistFilledInvoiceKey,
} from './filledInvoicesStore';
import { getActiveInvoiceShopKey } from '../invoiceShops';
import { normalizeNameKey } from './invoiceRowMatch';
import {
  BUYER_FACEBOOK_NO_INVOICE,
  BUYER_ZALO_NO_INVOICE,
  resolveInvoiceFillData,
} from './invoiceSourceFill';
import { fillInvoiceForm } from './invoiceModalFill';

function isClickInterceptedError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('click intercepted');
}

async function waitTableInteractionStability(browser: WdioBrowser): Promise<void> {
  await browser.execute(() => {
    const interactiveNoise = [
      '.ant-tooltip',
      '.ant-popover',
      '.ant-message',
      '.ant-notification',
      '.ant-dropdown',
      '.ant-spin-spinning',
    ];
    for (const sel of interactiveNoise) {
      const nodes = Array.from(document.querySelectorAll(sel));
      for (const node of nodes) {
        const el = node as HTMLElement;
        if (!el.offsetParent) {
          continue;
        }
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          el.style.pointerEvents = 'none';
        }
      }
    }
  });
  await browser.pause(120);
}

async function clickInvoiceRowSafely(
  browser: WdioBrowser,
  row: WdioElement
): Promise<void> {
  await row.scrollIntoView({ block: 'center' });
  await row.waitForDisplayed({ timeout: 8000 });
  await waitTableInteractionStability(browser);

  try {
    await row.click();
    return;
  } catch (err) {
    if (!isClickInterceptedError(err)) {
      throw err;
    }
  }

  await browser.pause(250);
  await row.scrollIntoView({ block: 'center' });
  await waitTableInteractionStability(browser);
  try {
    await row.click();
    return;
  } catch (err) {
    if (!isClickInterceptedError(err)) {
      throw err;
    }
  }

  await browser.execute((el: HTMLElement) => {
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, row as unknown as HTMLElement);
}

export async function processInvoicesByBuyerName(
  browser: WdioBrowser,
  invoiceRows: InvoiceRow[]
) {
  const processed = new Set(
    (await loadFilledInvoiceKeys(browser)).map((k) =>
      normalizeNameKey(String(k))
    )
  );
  if (processed.size > 0) {
    console.log(
      `[filled] Skipping ${processed.size} row(s) from previous runs (localStorage)`
    );
  }

  const meitSourceRules = getActiveInvoiceShopKey() === 'meit';

  /* eslint-disable no-constant-condition */
  while (true) {
    await browser.url(getInvoiceUrl());
    await browser.pause(3000);

    let processedOneOnPage = false;
    let scrollStepsWithoutNew = 0;

    /* eslint-disable no-constant-condition */
    while (true) {
      const rows = await browser.$$(SEL.rowWithStatus);
      console.log(
        'Rows with "Chưa phát hành" currently rendered:',
        rows.length
      );

      let processedOneThisStep = false;

      for (const row of rows) {
        const rawText = await row.getText();
        const rowText = rawText ? rawText.trim() : '';
        const key = normalizeNameKey(rowText);
        if (!key) {
          continue;
        }
        if (processed.has(key)) {
          continue;
        }

        const data = resolveInvoiceFillData(rowText, invoiceRows, {
          meitSourceRules,
        });
        if (!data) {
          console.warn(
            'No fill data for table row (no customer match / unrecognized nguồn đơn), skipping:',
            rowText
          );
          processed.add(key);
          continue;
        }
        if (
          meitSourceRules &&
          (data.buyerName === BUYER_FACEBOOK_NO_INVOICE ||
            data.buyerName === BUYER_ZALO_NO_INVOICE)
        ) {
          console.log(
            `[fill] MeiT placeholder buyer (${data.buyerName}) for row:`,
            rowText.slice(0, 120)
          );
        }

        await clickInvoiceRowSafely(browser, row);
        await browser.pause(4000);
        await fillInvoiceForm(browser, data);
        await browser.pause(3000);

        processed.add(key);
        await persistFilledInvoiceKey(browser, key);
        processedOneThisStep = true;
        processedOneOnPage = true;
        break;
      }

      if (processedOneThisStep) {
        scrollStepsWithoutNew = 0;
        break;
      }

      const scrolled = await browser.execute((selector) => {
        const el = document.querySelector(selector);
        if (!el || typeof el.scrollTop !== 'number') {
          return { ok: false, atEnd: true };
        }
        const prevTop = el.scrollTop || 0;
        const max = el.scrollHeight - el.clientHeight;
        const nextTop = Math.min(prevTop + 400, max);
        el.scrollTop = nextTop;
        const atEnd = nextTop >= max;
        return { ok: true, atEnd };
      }, SEL.virtualScroll);

      if (!scrolled.ok || scrolled.atEnd) {
        scrollStepsWithoutNew += 1;
      } else {
        scrollStepsWithoutNew = 0;
      }

      if (scrollStepsWithoutNew >= 2) {
        break;
      }

      await browser.pause(800);
    }

    if (!processedOneOnPage) {
      console.log(
        'No more rows could be matched to phone/buyerName entries; stopping.'
      );
      break;
    }
  }
}
