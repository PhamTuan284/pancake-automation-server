/**
 * Auto-fills the customer name on EasyPOS "Hóa đơn chưa phát hành" (unpublished) rows that
 * still show the generic "Bán cho người tiêu dùng" placeholder, appending the sales-channel
 * shop name so staff can tell at a glance where each order came from. Does NOT publish/phát
 * hành anything — only edits the draft customer name field.
 *
 * Naming rule (confirmed with the business owner):
 *   - Shop "MeiT Daily"      -> "Bán cho người tiêu dùng MeiT Daily"            (no platform name)
 *   - Any other shop         -> "Bán cho người tiêu dùng <Platform> <ShopName>"  (e.g. Tiktok MeiT World,
 *                                                                                      Shopee MeiT Mode)
 *
 * Usage (PowerShell, from pancake-automation-server/):
 *   npx tsx scripts/fixEasyposCustomerNames.ts            # dry run — lists what would change
 *   npx tsx scripts/fixEasyposCustomerNames.ts --apply    # actually edits + saves each row
 *
 * Requires EASYPOS_LOGIN_URL / EASYPOS_USERNAME / EASYPOS_PASSWORD in .env, and a chromedriver
 * build matching the installed Chrome (set CHROMEDRIVER_PATH if the bundled one is out of date).
 */
import '../features/pancake-einvoice/loadServerEnv';
import {
  connectPancakeBrowser,
  disposePancakeBrowserSession,
} from '../features/pancake-einvoice/automation/pancakeBrowser';
import type { WdioBrowser } from '../features/pancake-einvoice/automation/types';

const DEFAULT_NAME = 'Bán cho người tiêu dùng';
const INVOICE_LIST_URL = 'https://app.easypos.vn/easy-pos/ecommerce/e-commerce-invoice';
const MAX_ROWS_TO_PROCESS = 50;

const APPLY = process.argv.includes('--apply');

function platformFromLogoSrc(src: string): string {
  const s = src.toLowerCase();
  if (s.includes('tiktok')) return 'Tiktok';
  if (s.includes('shopee')) return 'Shopee';
  if (s.includes('lazada')) return 'Lazada';
  return 'Khác';
}

function computeNewName(platform: string, shopName: string): string {
  if (shopName.trim() === 'MeiT Daily') return `${DEFAULT_NAME} MeiT Daily`;
  return `${DEFAULT_NAME} ${platform} ${shopName}`.trim();
}

/**
 * Dismisses the Bootstrap-style "Hướng dẫn sử dụng" modal (`.btn-close`) and the separate
 * step-by-step "Hướng dẫn" walkthrough tour (no `.btn-close`; closed via its icon-only button,
 * or by walking through "Tiếp theo" if no close icon is found) — both reappear on every fresh
 * (incognito) session.
 */
async function closeAnyModal(browser: WdioBrowser) {
  for (let i = 0; i < 8; i++) {
    const action = await browser.execute(() => {
      const btnClose = document.querySelector('.btn-close') as HTMLElement | null;
      if (btnClose && btnClose.offsetParent !== null) {
        btnClose.click();
        return 'btn-close';
      }

      const headers = Array.from(document.querySelectorAll('*')).filter(
        (el) => el.children.length === 0 && (el.textContent || '').trim() === 'Hướng dẫn'
      );
      for (const h of headers) {
        let container: Element | null = h.parentElement;
        for (let d = 0; d < 5 && container; d++) {
          const buttons = Array.from(container.querySelectorAll('button'));
          const iconOnly = buttons.find((b) => (b.textContent || '').trim() === '');
          if (iconOnly) {
            (iconOnly as HTMLElement).click();
            return 'tour-close-icon';
          }
          const next = buttons.find((b) => (b.textContent || '').includes('Tiếp theo'));
          if (next) {
            (next as HTMLElement).click();
            return 'tour-next';
          }
          container = container.parentElement;
        }
      }
      return null;
    });
    if (!action) break;
    await browser.pause(400);
  }
}

async function login(browser: WdioBrowser) {
  const loginUrl = process.env.EASYPOS_LOGIN_URL;
  const username = process.env.EASYPOS_USERNAME;
  const password = process.env.EASYPOS_PASSWORD;
  if (!loginUrl || !username || !password) {
    throw new Error('Missing EASYPOS_LOGIN_URL / EASYPOS_USERNAME / EASYPOS_PASSWORD in .env');
  }

  await browser.url(loginUrl);
  await browser.pause(1200);

  const user = await browser.$('input[name="username"]');
  await user.waitForDisplayed({ timeout: 15000 });
  await user.click();
  await user.setValue(username);

  const pwd = await browser.$('input[name="password"]');
  await pwd.click();
  await pwd.setValue(password);

  const submit = await browser.$('button[type="submit"]');
  await submit.click();
  await browser.pause(4000);
  await closeAnyModal(browser);
}

async function goToUnpublishedInvoices(browser: WdioBrowser) {
  await browser.url(INVOICE_LIST_URL);
  await browser.pause(2500);
  await closeAnyModal(browser);

  let tab = await browser.$('*=Hóa đơn chưa phát hành');
  if (!(await tab.isExisting())) {
    // A multi-step walkthrough tour may still be covering the page; give it another pass.
    await browser.pause(1500);
    await closeAnyModal(browser);
    tab = await browser.$('*=Hóa đơn chưa phát hành');
  }
  await tab.waitForExist({ timeout: 15000 });
  await tab.click();
  await browser.pause(2000);
  await closeAnyModal(browser);
}

type PendingRow = {
  orderCode: string;
  platform: string;
  shopName: string;
  newName: string;
};

type RawPendingRow = { orderCode: string; shopName: string; logoSrc: string };

/** Reads every row (in DOM order) whose customer-name cell is still the unedited default. */
async function findAllPendingRows(browser: WdioBrowser): Promise<PendingRow[]> {
  const raws: RawPendingRow[] = await browser.execute((defaultName: string) => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    const out: { orderCode: string; shopName: string; logoSrc: string }[] = [];
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const nameCell = cells[2]; // checkbox, STT, Tên khách hàng
      const name = (nameCell.textContent || '').trim();
      if (name !== defaultName) continue;

      const orderCell = cells[3]; // Mã ĐH
      const code = orderCell.querySelector('.order-code');
      const shop = orderCell.querySelector('.shop-name');
      const logo = orderCell.querySelector('img');
      if (!code || !shop || !logo) continue;

      out.push({
        orderCode: (code.textContent || '').trim(),
        shopName: (shop.textContent || '').trim(),
        logoSrc: logo.getAttribute('src') || '',
      });
    }
    return out;
  }, DEFAULT_NAME);

  return raws.map((raw) => {
    const platform = platformFromLogoSrc(raw.logoSrc);
    const newName = computeNewName(platform, raw.shopName);
    return { orderCode: raw.orderCode, platform, shopName: raw.shopName, newName };
  });
}

async function findNextPendingRow(browser: WdioBrowser): Promise<PendingRow | null> {
  const all = await findAllPendingRows(browser);
  return all[0] ?? null;
}

async function clickEditForOrderCode(browser: WdioBrowser, orderCode: string): Promise<boolean> {
  return browser.execute((code: string) => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    for (const row of rows) {
      const codeEl = row.querySelector('.order-code');
      if (codeEl && (codeEl.textContent || '').trim() === code) {
        const editIcon = row.querySelector('span[data-action-key="edit"]') as HTMLElement | null;
        if (editIcon) {
          editIcon.click();
          return true;
        }
      }
    }
    return false;
  }, orderCode);
}

/**
 * Replaces the "Tên người mua" text by focusing it via JS (pointer clicks on it are intercepted
 * by the edit page's host element even once it's visibly rendered) and then sending real
 * keystrokes — Angular's dirty-tracking here only reacts to genuine key events, not
 * dispatched input/change events on the DOM node.
 */
async function applyNewCustomerName(browser: WdioBrowser, newName: string) {
  await browser.waitUntil(
    async () =>
      browser.execute(() => !!document.querySelector('input[placeholder="Tên người mua"]')),
    { timeout: 15000, timeoutMsg: 'Buyer-name input never appeared on the edit page.' }
  );

  // The form starts read-only — "Sửa" unlocks the fields and is what makes "Cập nhật" react
  // to changes at all (the Cập nhật button stays disabled forever otherwise).
  const clickedSua = await browser.execute(() => {
    const sua = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Sửa'
    ) as HTMLButtonElement | undefined;
    if (!sua) return false;
    sua.click();
    return true;
  });
  if (!clickedSua) {
    throw new Error('Could not find/click the "Sửa" button to unlock the form.');
  }
  await browser.pause(800);

  const focused = await browser.execute(() => {
    const input = document.querySelector('input[placeholder="Tên người mua"]') as HTMLInputElement | null;
    if (!input) return false;
    input.focus();
    return document.activeElement === input;
  });
  if (!focused) {
    throw new Error('Could not focus the buyer-name input.');
  }

  await browser.keys(['Control', 'a']);
  await browser.keys('Backspace');
  await browser.keys(newName);
  await browser.pause(300);

  const typedValue = await browser.execute(
    () => (document.querySelector('input[placeholder="Tên người mua"]') as HTMLInputElement | null)?.value
  );
  if (typedValue !== newName) {
    throw new Error(`Buyer-name input shows ${JSON.stringify(typedValue)}, expected ${JSON.stringify(newName)}.`);
  }

  // Blur so any (change)/(blur) handler the form relies on fires before we check the button.
  await browser.keys('Tab');
  await browser.pause(300);

  const clickedUpdate = await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const btn = document.querySelector('button.save-button-dialog') as HTMLButtonElement | null;
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      }),
    { timeout: 10000, timeoutMsg: 'Cập nhật button never became enabled after setting the name.' }
  );
  if (!clickedUpdate) {
    throw new Error('Could not click the Cập nhật button.');
  }
  await browser.pause(2000);
}

async function main() {
  console.log(APPLY ? 'Running in APPLY mode (will save changes).' : 'Running in DRY RUN mode (no changes saved). Pass --apply to save.');

  const session = await connectPancakeBrowser();
  const { browser } = session;
  try {
    await login(browser);
    await goToUnpublishedInvoices(browser);

    if (!APPLY) {
      const pending = await findAllPendingRows(browser);
      if (pending.length === 0) {
        console.log('No invoices with the default customer name found — nothing to do.');
      } else {
        console.log(`${pending.length} invoice(s) would be updated:\n`);
        for (const row of pending) {
          console.log(`[${row.orderCode}] ${row.shopName} (${row.platform}) -> "${row.newName}"`);
        }
        console.log('\nRe-run with --apply to save these changes.');
      }
    } else {
      let processed = 0;
      for (let i = 0; i < MAX_ROWS_TO_PROCESS; i++) {
        const pending = await findNextPendingRow(browser);
        if (!pending) break;

        console.log(
          `[${pending.orderCode}] ${pending.shopName} (${pending.platform}) -> "${pending.newName}"`
        );

        const clicked = await clickEditForOrderCode(browser, pending.orderCode);
        if (!clicked) {
          console.warn(`  Could not find/click edit icon for ${pending.orderCode}, stopping.`);
          break;
        }
        await browser.pause(3000);
        await closeAnyModal(browser);

        await applyNewCustomerName(browser, pending.newName);
        console.log(`  Saved.`);
        processed++;

        await goToUnpublishedInvoices(browser);
      }
      console.log(`\nDone. Updated ${processed} invoice(s).`);
    }
  } finally {
    await disposePancakeBrowserSession(session);
  }
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
