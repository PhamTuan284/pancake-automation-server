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

/** True if the POS login form (account + password) is already visible. */
async function loginFormAlreadyVisible(browser: WdioBrowser): Promise<boolean> {
  try {
    const pwd = await browser.$('input[type="password"]');
    if (!(await pwd.isDisplayed())) return false;
  } catch {
    return false;
  }
  const candidates = await browser.$$(
    'input[type="tel"], input[name="phone"], input[name="username"], input[autocomplete="username"], input[autocomplete="tel"], input[type="text"]'
  );
  for (const el of candidates) {
    try {
      if (await el.isDisplayed()) {
        const t = await el.getAttribute('type');
        if (t !== 'password') return true;
      }
    } catch {
      /* next */
    }
  }
  return false;
}

function landingCtaLabels(): string[] {
  const fromEnv = process.env.PANCAKE_LANDING_CTA_LABELS;
  if (fromEnv?.trim()) {
    return fromEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    'Dùng thử ngay',
    'Dùng thử',
    'Try now',
    'REGISTER NOW',
    'Register now',
    'Sign up',
  ];
}

function loginSubmitLabels(): string[] {
  const fromEnv = process.env.PANCAKE_LOGIN_SUBMIT_LABELS;
  if (fromEnv?.trim()) {
    return fromEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ['Đăng nhập', 'Log in', 'Login', 'Sign in'];
}

async function landingCtaVisible(
  browser: WdioBrowser,
  label: string
): Promise<boolean> {
  const lit = xpathStringLiteral(label);
  const xpaths = [
    `//button[contains(., ${lit})]`,
    `//a[contains(., ${lit})]`,
    `//*[@role="button"][contains(., ${lit})]`,
  ];
  for (const xp of xpaths) {
    const els = await browser.$$(xp);
    for (const el of els) {
      try {
        if (await el.isDisplayed()) return true;
      } catch {
        /* next */
      }
    }
  }
  return false;
}

async function landingCtaOrLoginFormVisible(
  browser: WdioBrowser
): Promise<boolean> {
  if (await loginFormAlreadyVisible(browser)) return true;
  for (const label of landingCtaLabels()) {
    if (await landingCtaVisible(browser, label)) return true;
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
 * 1) pos.pancake.vn → 2) landing CTA (Vi/En) or skip if login form visible → 3) account + password → 4) submit
 * 5) wait until URL is dashboard → 6) e-invoices
 *
 * Override CTA strings: `PANCAKE_LANDING_CTA_LABELS="Try now,Đăng nhập"` (comma-separated).
 */
export async function loginToPancake(browser: WdioBrowser) {
  const { phone, password } = getLoginCredentials();

  const homeUrl = process.env.PANCAKE_POS_HOME_URL || POS_HOME_URL;
  await browser.url(homeUrl);

  const landingWaitMs = Number(process.env.PANCAKE_LANDING_WAIT_MS) || 45000;
  await browser.waitUntil(
    () => landingCtaOrLoginFormVisible(browser),
    {
      timeout: landingWaitMs,
      interval: 800,
      timeoutMsg:
        'Login: no landing CTA matched and login form not visible. Set PANCAKE_LANDING_CTA_LABELS or PANCAKE_POS_HOME_URL.',
    }
  );

  if (!(await loginFormAlreadyVisible(browser))) {
    let clicked = false;
    for (const label of landingCtaLabels()) {
      if (await clickElementContaining(browser, label)) {
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      throw new Error(
        'Login: landing CTA was detected but click failed (cookie banner / overlay?). Retry or set PANCAKE_POS_HOME_URL to the login page.'
      );
    }
  }

  await browser.pause(1500);

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
      'Login: phone/account input not found after landing CTA / home load'
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

  let clickedSubmit = false;
  for (const label of loginSubmitLabels()) {
    if (await clickElementContaining(browser, label)) {
      clickedSubmit = true;
      break;
    }
  }
  if (!clickedSubmit) {
    const submit = await browser.$('button[type="submit"]');
    if (await submit.isExisting()) {
      await submit.click();
      clickedSubmit = true;
    }
  }
  if (!clickedSubmit) {
    throw new Error(
      'Login: submit button not found (tried Đăng nhập / Log in / submit). Set PANCAKE_LOGIN_SUBMIT_LABELS.'
    );
  }

  await waitForDashboardAfterLogin(browser);

  await browser.url(INVOICE_URL);
  await browser.pause(2000);
}
