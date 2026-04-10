/**
 * Plain JavaScript bodies for `browser.execute(string)` — never pass through TS emit.
 * Some prod pipelines (tsx/esbuild) inject `__name(...)` into nested `function` callbacks;
 * WebDriver serializes `fn.toString()` and runs it in Chrome, where `__name` is undefined.
 */

/** @returns {{ shopId: string | null; source: string | null }} */
export const EXEC_DISCOVER_SHOP_ID = `
return (function () {
  function pickShopId(text) {
    if (!text) return null;
    var m1 = text.match(/\\/shop\\/(\\d+)/i);
    if (m1 && m1[1]) return m1[1];
    var m2 = text.match(/\\bshop[-_]?id\\b["'=: ]+(\\d{6,})/i);
    if (m2 && m2[1]) return m2[1];
    return null;
  }
  var fromUrl = pickShopId(window.location.href);
  if (fromUrl) return { shopId: fromUrl, source: 'location.href' };
  var fromCookie = pickShopId(document.cookie);
  if (fromCookie) return { shopId: fromCookie, source: 'document.cookie' };
  try {
    for (var i = 0; i < window.localStorage.length; i++) {
      var lk = window.localStorage.key(i);
      if (!lk) continue;
      var lv = window.localStorage.getItem(lk) || '';
      var fromKv = pickShopId(lk + '=' + lv);
      if (fromKv) return { shopId: fromKv, source: 'localStorage:' + lk };
    }
  } catch (e0) {}
  try {
    for (var j = 0; j < window.sessionStorage.length; j++) {
      var sk = window.sessionStorage.key(j);
      if (!sk) continue;
      var sv = window.sessionStorage.getItem(sk) || '';
      var fromS = pickShopId(sk + '=' + sv);
      if (fromS) return { shopId: fromS, source: 'sessionStorage:' + sk };
    }
  } catch (e1) {}
  var links = document.querySelectorAll('a[href]');
  for (var a = 0; a < links.length; a++) {
    var href = (links[a].href || '');
    var sid = pickShopId(href);
    if (sid) return { shopId: sid, source: 'anchor.href' };
  }
  return { shopId: null, source: null };
})();
`;

/** @returns {string | null} */
export const EXEC_DISCOVER_INVOICE_URL_FROM_LINKS = `
return (function () {
  var RE_EI = /\\/shop\\/[0-9]+\\/e-invoices(?:[/?#]|$)/i;
  var RE_SHOP = /\\/shop\\/[0-9]+(?:[/?#]|$)/i;
  var links = document.querySelectorAll('a[href]');
  var hrefs = [];
  for (var i = 0; i < links.length; i++) {
    var h = (links[i].href || '').trim();
    if (h) hrefs.push(h);
  }
  var ei = null;
  for (var j = 0; j < hrefs.length; j++) {
    if (RE_EI.test(hrefs[j])) {
      ei = hrefs[j];
      break;
    }
  }
  if (ei) return ei;
  var shopRoot = null;
  for (var k = 0; k < hrefs.length; k++) {
    if (RE_SHOP.test(hrefs[k])) {
      shopRoot = hrefs[k];
      break;
    }
  }
  if (!shopRoot) return null;
  try {
    var u = new URL(shopRoot);
    var m = u.pathname.match(/\\/shop\\/([0-9]+)/i);
    if (m && m[1]) return u.origin + '/shop/' + m[1] + '/e-invoices';
  } catch (e) {
    return null;
  }
  return null;
})();
`;

/** Value injected via JSON.stringify — safe for WebDriver execute string. */
/** Scroll `.ant-modal-body` to bottom (e-invoice form). */
export const EXEC_SCROLL_INVOICE_MODAL_BODY = `
var b = document.querySelector('.ant-modal-body');
if (b && typeof b.scrollTop === 'number') {
  b.scrollTop = b.scrollHeight;
}
`;

/** @returns {string[]} */
export const EXEC_LOGIN_DEBUG_SNIPPETS = `
var out = [];
var nodes = document.querySelectorAll('a,button,[role="button"]');
for (var i = 0; i < nodes.length; i++) {
  var n = nodes[i];
  var txt = (n.textContent || '').replace(/\\s+/g, ' ').trim();
  if (!txt) continue;
  if (out.length >= 30) break;
  out.push(txt.slice(0, 80));
}
return out;
`;

export function buildExecTryFillInvoiceIdHeuristic(value: string): string {
  const v = JSON.stringify(value);
  return `
return (function () {
  var str = ${v};
  function setNativeValue(inputEl, val) {
    var Proto = inputEl.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    var desc = Object.getOwnPropertyDescriptor(Proto.prototype, 'value');
    if (desc && desc.set) {
      desc.set.call(inputEl, val);
    } else {
      inputEl.value = val;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var root = document.querySelector('.ant-modal-body');
  if (!root) return false;
  var nodes = root.querySelectorAll('input, textarea');
  var candidates = [];
  for (var i = 0; i < nodes.length; i++) {
    var inputEl = nodes[i];
    var t = (inputEl.type || '').toLowerCase();
    if (t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button' || t === 'file' || t === 'search') continue;
    if (inputEl.closest('.ant-select, .ant-picker, .ant-cascader, .ant-auto-complete, .ant-input-search')) continue;
    if (inputEl.getAttribute('role') === 'combobox') continue;
    if (inputEl.disabled || inputEl.readOnly) continue;
    var r = inputEl.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    var st = window.getComputedStyle(inputEl);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    candidates.push(inputEl);
  }
  if (candidates.length === 0) return false;
  var lastEmpty = null;
  for (var c = candidates.length - 1; c >= 0; c--) {
    if (!String(candidates[c].value || '').trim()) {
      lastEmpty = candidates[c];
      break;
    }
  }
  var target = lastEmpty || candidates[candidates.length - 1];
  target.scrollIntoView({ block: 'center' });
  target.focus();
  setNativeValue(target, str);
  return true;
})();
`;
}
