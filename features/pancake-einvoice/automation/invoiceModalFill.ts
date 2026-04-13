import type { InvoiceRow } from '../../../common/types/invoice';
import type { WdioBrowser, WdioElement } from './types';
import {
  INVOICE_FIELD_LABELS,
  INVOICE_FIELD_PLACEHOLDERS,
  SEL,
  type InvoiceFieldKey,
  xpathsForInvoiceLabeledField,
  xpathsForPlaceholder,
} from './xpathInvoiceUi';

async function waitInvoiceModal(browser: WdioBrowser) {
  const modal = await browser.$(SEL.invoiceModal);
  await modal.waitForDisplayed({ timeout: 20000 });
}

async function scrollInvoiceModalBodyToEnd(browser: WdioBrowser) {
  await browser.execute(() => {
    const b = document.querySelector('.ant-modal-body');
    if (b && typeof b.scrollTop === 'number') {
      b.scrollTop = b.scrollHeight;
    }
  });
  await browser.pause(300);
}

async function fillInvoiceControlElement(
  browser: WdioBrowser,
  el: WdioElement,
  str: string,
  logLabel: string,
  viaDescription: string
) {
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
      (elem: HTMLInputElement | HTMLTextAreaElement, v: string) => {
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
      el as unknown as HTMLInputElement,
      str
    );
  }
  console.log(`[fill] ${logLabel}: ok (${viaDescription})`);
  return true;
}

async function tryFillInvoiceFieldByPlaceholders(
  browser: WdioBrowser,
  placeholderVariants: string | readonly string[],
  value: unknown,
  logLabel: string
) {
  if (value === undefined || value === null) {
    return false;
  }
  const str = String(value);
  const variants = Array.isArray(placeholderVariants)
    ? [...placeholderVariants]
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
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  return false;
}

async function safeSetInvoiceField(
  browser: WdioBrowser,
  labelVariants: string | readonly string[],
  value: unknown,
  logLabel: string
) {
  if (value === undefined || value === null) {
    return false;
  }
  const str = String(value);
  const variants = Array.isArray(labelVariants)
    ? [...labelVariants]
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
          err instanceof Error ? err.message : err
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

async function tryFillInvoiceIdFieldHeuristic(
  browser: WdioBrowser,
  value: unknown
) {
  const str = String(value).trim();
  if (!str) {
    return false;
  }

  const ok = await browser.execute((v: string) => {
    function setNativeValue(
      inputEl: HTMLInputElement | HTMLTextAreaElement,
      val: string
    ) {
      const Proto =
        inputEl instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement
          : HTMLInputElement;
      const desc = Object.getOwnPropertyDescriptor(Proto.prototype, 'value');
      if (desc && desc.set) {
        desc.set.call(inputEl, val);
      } else {
        inputEl.value = val;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const root = document.querySelector('.ant-modal-body');
    if (!root) {
      return false;
    }

    const nodes = Array.from(
      root.querySelectorAll('input, textarea')
    ) as (HTMLInputElement | HTMLTextAreaElement)[];
    const candidates = nodes.filter((inputEl) => {
      const t = (inputEl.type || '').toLowerCase();
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
        inputEl.closest(
          '.ant-select, .ant-picker, .ant-cascader, .ant-auto-complete, .ant-input-search'
        )
      ) {
        return false;
      }
      if (inputEl.getAttribute('role') === 'combobox') {
        return false;
      }
      if (inputEl.disabled || inputEl.readOnly) {
        return false;
      }
      const r = inputEl.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        return false;
      }
      const st = window.getComputedStyle(inputEl);
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
      .find((inputEl) => !String(inputEl.value || '').trim());
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

async function fillInvoiceField(
  browser: WdioBrowser,
  fieldKey: InvoiceFieldKey,
  value: unknown,
  options: { heuristicIdFallback?: boolean } = {}
) {
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

export async function fillInvoiceForm(browser: WdioBrowser, data: InvoiceRow) {
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
