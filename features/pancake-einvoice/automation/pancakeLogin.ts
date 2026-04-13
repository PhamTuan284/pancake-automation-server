import type { WdioBrowser } from './types';
import {
  INVOICE_URL,
  POS_DASHBOARD_URL_SNIPPET,
  POS_HOME_URL,
} from './constants';

function getLoginCredentials() {
  const phone = process.env.PANCAKE_LOGIN_PHONE || process.env.PANCAKE_ACCOUNT;
  const password =
    process.env.PANCAKE_LOGIN_PASSWORD || process.env.PANCAKE_PASSWORD;
  if (!phone || !password) {
    throw new Error(
      'Missing login: set PANCAKE_LOGIN_PHONE and PANCAKE_LOGIN_PASSWORD in pancake-automation-server/.env (copy from .env.example)'
    );
  }
  return { phone: String(phone).trim(), password: String(password).trim() };
}

/** XPath string literal (handles embedded ' for XPath 1.0). */
function xpathStringLiteral(s: unknown) {
  const str = String(s);
  if (!str.includes("'")) return `'${str}'`;
  const parts = str.split("'");
  let expr = `'${parts[0]}'`;
  for (let i = 1; i < parts.length; i++) {
    expr = `concat(${expr}, "'", '${parts[i]}')`;
  }
  return expr;
}

async function clickElementContaining(browser: WdioBrowser, text: string) {
  const lit = xpathStringLiteral(text);
  const xpaths = [
    `//button[contains(., ${lit})]`,
    `//a[contains(., ${lit})]`,
    `//*[@role="button"][contains(., ${lit})]`,
    `//*[contains(., ${lit})]`,
  ];
  for (const xp of xpaths) {
    const els = await browser.$$(xp);
    for (const el of els) {
      try {
        if (await el.isDisplayed()) {
          await el.click();
          return true;
        }
      } catch {
        /* try next */
      }
    }
  }
  return false;
}

async function waitForDashboardAfterLogin(browser: WdioBrowser) {
  const timeoutMs = Number(process.env.PANCAKE_DASHBOARD_WAIT_MS) || 120000;
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes(POS_DASHBOARD_URL_SNIPPET),
    {
      timeout: timeoutMs,
      interval: 400,
      timeoutMsg: `Login did not redirect to https://pos.pancake.vn/dashboard within ${timeoutMs}ms`,
    }
  );
}

/**
 * 1) pos.pancake.vn → 2) "Dùng thử ngay" → 3) account + password → 4) "Đăng nhập"
 * 5) wait until URL is dashboard → 6) e-invoices
 */
export async function loginToPancake(browser: WdioBrowser) {
  const { phone, password } = getLoginCredentials();

  const homeUrl = process.env.PANCAKE_POS_HOME_URL || POS_HOME_URL;
  await browser.url(homeUrl);
  await browser.pause(2500);

  const clickedTry = await clickElementContaining(browser, 'Dùng thử ngay');
  if (!clickedTry) {
    throw new Error('Login: "Dùng thử ngay" not found on pos.pancake.vn');
  }

  await browser.pause(2500);

  const phoneSelectors = [
    'input[type="tel"]',
    'input[name="phone"]',
    'input[name="username"]',
    'input[autocomplete="username"]',
    'input[autocomplete="tel"]',
    'input[type="text"]',
  ];
  let phoneEl = null;
  for (const sel of phoneSelectors) {
    const el = await browser.$(sel);
    if (await el.isExisting()) {
      try {
        await el.waitForDisplayed({ timeout: 3000 });
        if (await el.isDisplayed()) {
          phoneEl = el;
          break;
        }
      } catch {
        /* next */
      }
    }
  }
  if (!phoneEl) {
    const inputs = await browser.$$('input[type="text"], input[type="tel"]');
    for (const el of inputs) {
      if (await el.isDisplayed()) {
        const t = await el.getAttribute('type');
        if (t !== 'password') {
          phoneEl = el;
          break;
        }
      }
    }
  }
  if (!phoneEl) {
    throw new Error(
      'Login: phone/account input not found after "Dùng thử ngay"'
    );
  }

  await phoneEl.click();
  await phoneEl.clearValue();
  await phoneEl.setValue(phone);

  const passwordEl = await browser.$('input[type="password"]');
  await passwordEl.waitForDisplayed({ timeout: 15000 });
  await passwordEl.click();
  await passwordEl.clearValue();
  await passwordEl.setValue(password);

  let loginBtn = await browser.$('//button[contains(., "Đăng nhập")]');
  if (!(await loginBtn.isExisting())) {
    loginBtn = await browser.$(
      '//*[self::button or self::a][contains(., "Đăng nhập")]'
    );
  }
  if (!(await loginBtn.isExisting())) {
    loginBtn = await browser.$('button[type="submit"]');
  }
  if (!(await loginBtn.isExisting())) {
    throw new Error('Login: "Đăng nhập" button not found');
  }
  await loginBtn.click();

  await waitForDashboardAfterLogin(browser);

  await browser.url(INVOICE_URL);
  await browser.pause(2000);
}
