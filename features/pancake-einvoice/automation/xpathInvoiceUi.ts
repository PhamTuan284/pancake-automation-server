/**
 * Selectors: Pancake may change the DOM — adjust in one place.
 * Table: Ant virtual list — div.ant-table-row.
 * Modal "Hóa đơn điện tử": invoice-label + ant-input (Đơn vị / Mẫu số / Kí hiệu left to UI defaults).
 */
export const SEL = {
  rowWithStatus:
    '//div[contains(@class, "ant-table-row") and .//span[contains(text(), "Chưa phát hành")]]',
  virtualScroll: '.ant-table-tbody-virtual-holder',
  invoiceModal: '.ant-modal-content',
  /**
   * Draft-only save. Target the footer `button` whose full label is exactly "Lưu", not
   * "Lưu và phát hành" (which can wrongly match `//span[normalize-space(.)="Lưu"]/ancestor::button`
   * when the label is split across nodes).
   */
  saveDraft:
    '//div[contains(@class, "ant-modal-footer")]//button[normalize-space(.)="Lưu"]',
} as const;

const XPATH_TEXTISH_CONTROL =
  '*[local-name()="input" or local-name()="textarea"][not(@type="hidden") and (not(@type) or (@type!="checkbox" and @type!="radio" and @type!="submit" and @type!="button"))]';

const XPATH_ANT_INPUT =
  '*[local-name()="input" or local-name()="textarea"][contains(@class, "ant-input")]';

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

export function xpathsForInvoiceLabeledField(labelContains: string) {
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

export function xpathsForPlaceholder(placeholderSubstring: string) {
  const lit = xpathStringLiteral(placeholderSubstring);
  const body = '//div[contains(@class, "ant-modal-body")]';
  const content = '//div[contains(@class, "ant-modal-content")]';
  return [
    `${body}//*[local-name()="input" or local-name()="textarea"][contains(@placeholder, ${lit})]`,
    `${content}//*[local-name()="input" or local-name()="textarea"][contains(@placeholder, ${lit})]`,
  ];
}

export const INVOICE_FIELD_PLACEHOLDERS = {
  phone: ['Nhập số điện thoại', 'số điện thoại'],
  buyerName: ['Nhập tên người mua', 'tên người mua'],
  operationName: ['Nhập đơn vị mua hàng', 'đơn vị mua hàng'],
  taxCode: ['Nhập mã số thuế', 'mã số thuế'],
  address: ['Nhập địa chỉ', 'địa chỉ'],
  idNumber: ['Nhập số CCCD', 'số CCCD', 'CCCD'],
} as const;

export const INVOICE_FIELD_LABELS = {
  phone: ['Số điện thoại', 'Điện thoại'],
  buyerName: ['Người mua hàng', 'Tên người mua'],
  operationName: ['Đơn vị mua hàng', 'Tên đơn vị mua hàng', 'Khách hàng'],
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
} as const;

export type InvoiceFieldKey = keyof typeof INVOICE_FIELD_PLACEHOLDERS;
