const { remote } = require('webdriverio');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const http = require('http');
const net = require('net');

const chromedriver = require('chromedriver');

const INVOICE_URL =
  'https://pos.pancake.vn/shop/1942925579/e-invoices';

/** Marketing home; optional override PANCAKE_POS_HOME_URL */
const POS_HOME_URL = 'https://pos.pancake.vn/';

/** Successful POS login lands here; `getUrl()` may include query/hash. */
const POS_DASHBOARD_URL_SNIPPET = 'pos.pancake.vn/dashboard';

function loadInvoiceData() {
  const p = path.join(__dirname, 'invoiceData.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

const FILLED_INVOICES_FILE = path.join(__dirname, 'filledInvoices.json');

/** Row keys we already filled + saved (same normalization as in-run `processed`). */
function loadFilledInvoiceKeys() {
  try {
    if (!fs.existsSync(FILLED_INVOICES_FILE)) {
      return [];
    }
    const j = JSON.parse(fs.readFileSync(FILLED_INVOICES_FILE, 'utf8'));
    if (Array.isArray(j)) {
      return j.filter(Boolean);
    }
    if (j && Array.isArray(j.keys)) {
      return j.keys.filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

function persistFilledInvoiceKey(key) {
  if (!key) {
    return;
  }
  const existing = new Set(loadFilledInvoiceKeys());
  if (existing.has(key)) {
    return;
  }
  existing.add(key);
  const keys = [...existing].sort();
  fs.writeFileSync(
    FILLED_INVOICES_FILE,
    JSON.stringify(
      { keys, updatedAt: new Date().toISOString() },
      null,
      2
    ),
    'utf8'
  );
  console.log(
    `[filled] Saved row key to filledInvoices.json (${keys.length} total)`
  );
}

/** Lowercase for matching; prefer vi-VN so Vietnamese casing rules apply when available. */
function localeLower(s) {
  const str = String(s);
  try {
    return str.toLocaleLowerCase('vi-VN');
  } catch {
    return str.toLowerCase();
  }
}

function normalizeName(value) {
  if (value == null) return '';
  // NFKC: unify compatibility characters; then strip accents; collapse spaces; case-fold.
  return localeLower(
    String(value)
      .normalize('NFKC')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function normalizePhone(value) {
  if (value == null) return '';
  return String(value).replace(/\D+/g, '');
}

function findByBuyerName(invoiceRows, rowText) {
  const rowNorm = normalizeName(rowText);
  if (!rowNorm) return null;
  const rowTrim = String(rowText).trim();
  const rowLc = localeLower(rowTrim);

  return (
    invoiceRows.find((r) => {
      const nameNorm = normalizeName(r.buyerName);
      if (!nameNorm) return false;
      const buyerTrim = String(r.buyerName).trim();
      const buyerLc = localeLower(buyerTrim);

      if (
        rowNorm === nameNorm ||
        rowNorm.includes(nameNorm) ||
        nameNorm.includes(rowNorm)
      ) {
        return true;
      }

      // Case-insensitive substring match on raw text (row often includes phone, extra words).
      if (rowLc.includes(buyerLc) || buyerLc.includes(rowLc)) {
        return true;
      }

      // Whole-string match ignoring case and accent differences.
      try {
        if (
          rowTrim.localeCompare(buyerTrim, 'vi', { sensitivity: 'base' }) ===
          0
        ) {
          return true;
        }
      } catch {
        if (rowLc === buyerLc) {
          return true;
        }
      }

      return false;
    }) || null
  );
}

function findByPhone(invoiceRows, phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  return (
    invoiceRows.find((r) => normalizePhone(r.phone) === phone) || null
  );
}

/** Avoid binding to a stale ChromeDriver from a previous crashed run. */
function getFreeTcpPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = typeof addr === 'object' && addr ? addr.port : null;
      s.close(() => (p != null ? resolve(p) : reject(new Error('No port'))));
    });
    s.on('error', reject);
  });
}

function waitForChromeDriverStatus(port, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function ping() {
      const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        schedule();
      });
      req.on('error', () => schedule());
      req.setTimeout(2000, () => {
        req.destroy();
        schedule();
      });
    }
    function schedule() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`ChromeDriver not ready on port ${port}`));
        return;
      }
      setTimeout(ping, 200);
    }
    ping();
  });
}

/**
 * Start ChromeDriver on a free port and return { port, child }.
 * Caller must kill child on exit.
 */
async function startChromeDriver() {
  const port = await getFreeTcpPort();
  const { spawn } = require('child_process');
  const child = spawn(chromedriver.path, [`--port=${port}`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForChromeDriverStatus(port);
  return { port, child };
}

/** XPath string literal (handles embedded ' for XPath 1.0). */
function xpathStringLiteral(s) {
  const str = String(s);
  if (!str.includes("'")) return `'${str}'`;
  const parts = str.split("'");
  let expr = `'${parts[0]}'`;
  for (let i = 1; i < parts.length; i++) {
    expr = `concat(${expr}, "'", '${parts[i]}')`;
  }
  return expr;
}

/**
 * Selectors: Pancake may change the DOM — adjust in one place.
 * Table: Ant virtual list — div.ant-table-row.
 * Modal "Hóa đơn điện tử": invoice-label + ant-input (Đơn vị / Mẫu số / Kí hiệu left to UI defaults).
 */
const SEL = {
  rowWithStatus:
    '//div[contains(@class, "ant-table-row") and .//span[contains(text(), "Chưa phát hành")]]',
  // Virtual scroll container for Ant Design table body (the element whose scrollTop changes)
  virtualScroll: '.ant-table-tbody-virtual-holder',
  invoiceModal: '.ant-modal-content',
  /** Save draft only (not "Lưu và phát hành"). */
  saveDraft:
    '//div[contains(@class, "ant-modal-footer")]//span[normalize-space(.)="Lưu"]/ancestor::button[1]',
};

/**
 * Visible text-ish controls. Chrome XPath does not accept `(input|textarea)` as a step; use local-name().
 */
const XPATH_TEXTISH_CONTROL =
  '*[local-name()="input" or local-name()="textarea"][not(@type="hidden") and (not(@type) or (@type!="checkbox" and @type!="radio" and @type!="submit" and @type!="button"))]';

const XPATH_ANT_INPUT =
  '*[local-name()="input" or local-name()="textarea"][contains(@class, "ant-input")]';

/**
 * XPaths for one invoice modal field, ordered: try until one matches.
 * Pancake mixes `invoice-label` rows with standard Ant `ant-form-item` + `ant-form-item-label`
 * (often used for CCCD / định danh); those need the form-item paths first.
 */
function xpathsForInvoiceLabeledField(labelContains) {
  const lit = xpathStringLiteral(labelContains);
  const body = '//div[contains(@class, "ant-modal-body")]';
  const content = '//div[contains(@class, "ant-modal-content")]';
  const lbl = `*[contains(@class, "invoice-label") and contains(., ${lit})]`;

  const formItem = [
    `${body}//div[contains(@class, "ant-form-item")][.//*[contains(@class, "ant-form-item-label")][contains(., ${lit})]]//${XPATH_TEXTISH_CONTROL}`,
    `${body}//div[contains(@class, "ant-form-item-label")][contains(., ${lit})]/ancestor::div[contains(@class, "ant-form-item")][1]//${XPATH_TEXTISH_CONTROL}`,
    `${body}//label[contains(., ${lit})]/ancestor::div[contains(@class, "ant-form-item")][1]//${XPATH_TEXTISH_CONTROL}`,
    `${body}//label[contains(., ${lit})]/following::input[not(@type="hidden")][1]`,
    `${body}//label[contains(., ${lit})]/following::textarea[not(@type="hidden")][1]`,
    `${body}//div[contains(@class, "ant-form-item")][contains(., ${lit})]//${XPATH_TEXTISH_CONTROL}`,
  ];

  const invoiceLabel = [
    `${body}//${lbl}/ancestor::div[contains(@class, "ant-row")][1]//${XPATH_ANT_INPUT}`,
    `${body}//${lbl}/ancestor::div[contains(@class, "ant-row")][1]//${XPATH_TEXTISH_CONTROL}`,
    `${body}//${lbl}/following-sibling::div[contains(@class, "input-invoice")]//${XPATH_ANT_INPUT}`,
    `${body}//${lbl}/following-sibling::div[contains(@class, "input-invoice")]//${XPATH_TEXTISH_CONTROL}`,
    `${body}//${lbl}/ancestor::div[contains(@class, "ant-col")][1]/following-sibling::div[contains(@class, "ant-col")]//${XPATH_ANT_INPUT}`,
    `${body}//${lbl}/ancestor::div[contains(@class, "ant-col")][1]/following-sibling::div[contains(@class, "ant-col")]//${XPATH_TEXTISH_CONTROL}`,
    `${content}//${lbl}/ancestor::div[contains(@class, "ant-row")][1]//${XPATH_ANT_INPUT}`,
    `${content}//${lbl}/ancestor::div[contains(@class, "ant-row")][1]//${XPATH_TEXTISH_CONTROL}`,
    `${body}//${lbl}/following-sibling::div[contains(@class, "input-invoice")]//input`,
    `${body}//${lbl}/following-sibling::div[contains(@class, "input-invoice")]//textarea`,
  ];

  return [...formItem, ...invoiceLabel];
}

/**
 * Pancake e-invoice modal often exposes `placeholder="Nhập …"` on the real input while labels
 * sit in a separate column (our label XPaths miss). Match by placeholder substring.
 */
function xpathsForPlaceholder(placeholderSubstring) {
  const lit = xpathStringLiteral(placeholderSubstring);
  const body = '//div[contains(@class, "ant-modal-body")]';
  const content = '//div[contains(@class, "ant-modal-content")]';
  return [
    `${body}//*[local-name()="input" or local-name()="textarea"][contains(@placeholder, ${lit})]`,
    `${content}//*[local-name()="input" or local-name()="textarea"][contains(@placeholder, ${lit})]`,
  ];
}

/** Substrings of `placeholder` text on inputs (from Pancake UI). */
const INVOICE_FIELD_PLACEHOLDERS = {
  phone: ['Nhập số điện thoại', 'số điện thoại'],
  buyerName: ['Nhập đơn vị mua hàng', 'đơn vị mua hàng'],
  taxCode: ['Nhập mã số thuế', 'mã số thuế'],
  address: ['Nhập địa chỉ', 'địa chỉ'],
  idNumber: ['Nhập số CCCD', 'số CCCD', 'CCCD'],
};

/** Label substrings to try (UI wording variants). */
const INVOICE_FIELD_LABELS = {
  phone: ['Số điện thoại', 'Điện thoại'],
  buyerName: [
    'Đơn vị mua hàng',
    'Người mua hàng',
    'Tên đơn vị mua hàng',
    'Khách hàng',
  ],
  taxCode: ['Mã số thuế', 'MST'],
  address: ['Địa chỉ'],
  idNumber: [
    'Số định danh cá nhân',
    'Định danh cá nhân',
    'Mã định danh',
    'Số định danh',
    'Căn cước công dân',
    'Số CCCD',
    'Số CMND',
    'Giấy tờ tùy thân',
    'CCCD',
    'CMND',
  ],
};

async function waitInvoiceModal(browser) {
  const modal = await browser.$(SEL.invoiceModal);
  await modal.waitForDisplayed({ timeout: 20000 });
}

/** Scroll e-invoice modal body so lower fields (e.g. CCCD) are in the DOM viewport. */
async function scrollInvoiceModalBodyToEnd(browser) {
  await browser.execute(() => {
    const b = document.querySelector('.ant-modal-body');
    if (b && typeof b.scrollTop === 'number') {
      b.scrollTop = b.scrollHeight;
    }
  });
  await browser.pause(300);
}

/**
 * Focus, clear, set value on a resolved input/textarea; React fallback if value does not stick.
 */
async function fillInvoiceControlElement(browser, el, str, logLabel, viaDescription) {
  await el.scrollIntoView({ block: 'center' });
  await el.waitForDisplayed({ timeout: 8000 });
  await el.click();
  await browser.pause(120);
  try {
    await el.clearValue();
  } catch {
    /* some builds */
  }
  await el.setValue(str);
  let current = '';
  try {
    current = await el.getValue();
  } catch {
    /* */
  }
  if (current !== str) {
    await browser.execute(
      (elem, v) => {
        const desc =
          elem instanceof HTMLTextAreaElement
            ? Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                'value'
              )
            : Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
              );
        if (desc && desc.set) {
          desc.set.call(elem, v);
        } else {
          elem.value = v;
        }
        elem.dispatchEvent(new Event('input', { bubbles: true }));
        elem.dispatchEvent(new Event('change', { bubbles: true }));
      },
      el,
      str
    );
  }
  console.log(`[fill] ${logLabel}: ok (${viaDescription})`);
  return true;
}

/** Try `placeholder="Nhập …"` on inputs (Pancake buyer section). */
async function tryFillInvoiceFieldByPlaceholders(
  browser,
  placeholderVariants,
  value,
  logLabel
) {
  if (value === undefined || value === null) {
    return false;
  }
  const str = String(value);
  const variants = Array.isArray(placeholderVariants)
    ? placeholderVariants
    : [placeholderVariants];

  for (const ph of variants) {
    const xpaths = xpathsForPlaceholder(ph);
    for (const xp of xpaths) {
      const el = await browser.$(xp);
      if (!(await el.isExisting())) {
        continue;
      }
      let displayed = false;
      try {
        displayed = await el.isDisplayed();
      } catch {
        displayed = false;
      }
      if (!displayed) {
        continue;
      }
      try {
        return await fillInvoiceControlElement(
          browser,
          el,
          str,
          logLabel,
          `placeholder "${ph}"`
        );
      } catch (err) {
        console.warn(
          `[fill] ${logLabel} placeholder "${ph}" failed:`,
          err && err.message ? err.message : err
        );
      }
    }
  }
  return false;
}

/**
 * Set a text/textarea control in the e-invoice modal; tries several XPaths and label variants.
 */
async function safeSetInvoiceField(browser, labelVariants, value, logLabel) {
  if (value === undefined || value === null) {
    return false;
  }
  const str = String(value);
  const variants = Array.isArray(labelVariants)
    ? labelVariants
    : [labelVariants];

  for (const labelSub of variants) {
    const xpaths = xpathsForInvoiceLabeledField(labelSub);
    for (const xp of xpaths) {
      const el = await browser.$(xp);
      if (!(await el.isExisting())) {
        continue;
      }
      let displayed = false;
      try {
        displayed = await el.isDisplayed();
      } catch {
        displayed = false;
      }
      if (!displayed) {
        continue;
      }
      try {
        return await fillInvoiceControlElement(
          browser,
          el,
          str,
          logLabel,
          `label "${labelSub}"`
        );
      } catch (err) {
        console.warn(
          `[fill] ${logLabel} attempt failed for label "${labelSub}":`,
          err && err.message ? err.message : err
        );
      }
    }
  }
  console.warn(
    `[skip] Field not found or not settable (${logLabel}); tried label variants:`,
    variants.join(' | ')
  );
  return false;
}

/** Placeholders first (Pancake), then label XPaths, then optional ID heuristic. */
async function fillInvoiceField(browser, fieldKey, value, options = {}) {
  const { heuristicIdFallback = false } = options;
  const placeholders = INVOICE_FIELD_PLACEHOLDERS[fieldKey];
  const labels = INVOICE_FIELD_LABELS[fieldKey];

  if (
    placeholders &&
    (await tryFillInvoiceFieldByPlaceholders(
      browser,
      placeholders,
      value,
      fieldKey
    ))
  ) {
    return true;
  }
  if (await safeSetInvoiceField(browser, labels, value, fieldKey)) {
    return true;
  }
  if (
    heuristicIdFallback &&
    fieldKey === 'idNumber' &&
    value != null &&
    String(value).trim() !== ''
  ) {
    return tryFillInvoiceIdFieldHeuristic(browser, value);
  }
  return false;
}

/**
 * Pancake sometimes renders định danh / CCCD without `invoice-label` / `ant-form-item-label` text we match.
 * After other fields are filled, pick the last visible plain `input`/`textarea` in the modal body
 * (prefer the last empty one in document order) and set the value with React-friendly events.
 */
async function tryFillInvoiceIdFieldHeuristic(browser, value) {
  const str = String(value).trim();
  if (!str) {
    return false;
  }

  const ok = await browser.execute((v) => {
    function setNativeValue(el, val) {
      const Proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement
          : HTMLInputElement;
      const desc = Object.getOwnPropertyDescriptor(Proto.prototype, 'value');
      if (desc && desc.set) {
        desc.set.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const root = document.querySelector('.ant-modal-body');
    if (!root) {
      return false;
    }

    const nodes = Array.from(root.querySelectorAll('input, textarea'));
    const candidates = nodes.filter((el) => {
      const t = (el.type || '').toLowerCase();
      if (
        t === 'hidden' ||
        t === 'checkbox' ||
        t === 'radio' ||
        t === 'submit' ||
        t === 'button' ||
        t === 'file' ||
        t === 'search'
      ) {
        return false;
      }
      if (
        el.closest(
          '.ant-select, .ant-picker, .ant-cascader, .ant-auto-complete, .ant-input-search'
        )
      ) {
        return false;
      }
      if (el.getAttribute('role') === 'combobox') {
        return false;
      }
      if (el.disabled || el.readOnly) {
        return false;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        return false;
      }
      const st = window.getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      return false;
    }

    const lastEmpty = [...candidates]
      .reverse()
      .find((el) => !String(el.value || '').trim());
    const target = lastEmpty || candidates[candidates.length - 1];

    target.scrollIntoView({ block: 'center' });
    target.focus();
    setNativeValue(target, v);
    return true;
  }, str);

  if (ok) {
    console.log(
      '[fill] idNumber: ok (heuristic: last empty or last text control in .ant-modal-body)'
    );
    return true;
  }
  console.warn(
    '[skip] idNumber: heuristic found no suitable control in .ant-modal-body'
  );
  return false;
}

async function processInvoicesByBuyerName(browser, invoiceRows) {
  const processed = new Set(loadFilledInvoiceKeys());
  if (processed.size > 0) {
    console.log(
      `[filled] Skipping ${processed.size} row(s) from previous runs (filledInvoices.json)`
    );
  }

  // Loop until there are no more matching rows or nothing new can be processed.
  /* eslint-disable no-constant-condition */
  while (true) {
    await browser.url(INVOICE_URL);
    await browser.pause(3000);

    let processedOneOnPage = false;
    let scrollStepsWithoutNew = 0;

    // Walk the virtual list on this page by scrolling until we reach the end
    // or can no longer find any new matching rows.
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
        const key = normalizeName(rowText);
        if (!key) {
          // Empty / non-textual row, skip without marking processed.
          continue;
        }
        if (processed.has(key)) {
          continue;
        }

        // Prefer matching by phone if possible, fallback to buyer name.
        const phoneMatch = rowText.match(/\d{9,11}/);
        let data = null;
        if (phoneMatch) {
          data = findByPhone(invoiceRows, phoneMatch[0]);
        }
        if (!data) {
          data = findByBuyerName(invoiceRows, rowText);
        }
        if (!data) {
          console.warn(
            'No JSON row matched by phone/buyerName for table row, skipping:',
            rowText
          );
          processed.add(key);
          continue;
        }

        await row.click();
        await browser.pause(4000);
        await fillInvoiceForm(browser, data);
        await browser.pause(3000);

        processed.add(key);
        persistFilledInvoiceKey(key);
        processedOneThisStep = true;
        processedOneOnPage = true;
        break; // re-load list after each processed invoice
      }

      if (processedOneThisStep) {
        // We just processed a row; reload list on this page from the top.
        scrollStepsWithoutNew = 0;
        break;
      }

      // No row processed this iteration: scroll down to render more rows.
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

      // If we reached the bottom (or can't scroll) and still found nothing new,
      // stop scrolling on this page.
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

async function fillInvoiceForm(browser, data) {
  await waitInvoiceModal(browser);
  await browser.pause(400);

  await fillInvoiceField(browser, 'phone', data.phone);
  await fillInvoiceField(browser, 'buyerName', data.buyerName);
  await fillInvoiceField(browser, 'taxCode', data.taxCode);
  await fillInvoiceField(browser, 'address', data.address);
  await scrollInvoiceModalBodyToEnd(browser);
  await fillInvoiceField(browser, 'idNumber', data.idNumber, {
    heuristicIdFallback: true,
  });

  const btn = await browser.$(SEL.saveDraft);
  if (await btn.isExisting()) {
    await btn.waitForDisplayed({ timeout: 10000 });
    await btn.click();
  } else {
    const fallback = await browser.$(
      '//div[contains(@class, "ant-modal-footer")]//button[normalize-space(.)="Lưu"]'
    );
    if (await fallback.isExisting()) {
      await fallback.click();
    } else {
      console.warn('[skip] "Lưu" button not found');
    }
  }
}

function getLoginCredentials() {
  const phone = process.env.PANCAKE_LOGIN_PHONE || process.env.PANCAKE_ACCOUNT;
  const password = process.env.PANCAKE_LOGIN_PASSWORD || process.env.PANCAKE_PASSWORD;
  if (!phone || !password) {
    throw new Error(
      'Missing login: set PANCAKE_LOGIN_PHONE and PANCAKE_LOGIN_PASSWORD in pancake-automation-server/.env (copy from .env.example)'
    );
  }
  return { phone: String(phone).trim(), password: String(password) };
}

/** Click first visible control whose text contains `text` (button / link / role=button). */
async function clickElementContaining(browser, text) {
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

async function waitForDashboardAfterLogin(browser) {
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
async function loginToPancake(browser) {
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
    throw new Error('Login: phone/account input not found after "Dùng thử ngay"');
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

async function runPancakeFlow() {
  const invoiceRows = loadInvoiceData();
  let driverChild = null;

  const { port, child } = await startChromeDriver();
  driverChild = child;

  let browser;
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
            // Avoid restoring last session (e.g. pos.pancake.vn) as the first visible page
            '--incognito',
          ],
        },
      },
      // Retries here each open a new browser session — keep low once ChromeDriver is ready.
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
      } catch (e) {
        /* ignore */
      }
    }
    if (driverChild) {
      try {
        driverChild.kill();
      } catch (e) {
        /* ignore */
      }
    }
  }
}

module.exports = { runPancakeFlow };

// Allow: node pancakeAutomation.js
if (require.main === module) {
  runPancakeFlow().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
