import {
  getActiveMeiTAutomationVariant,
  getMeiTAutomationConfig,
  type MeiTAutomationVariant,
} from './meitAutomationVariants';

export type { MeiTAutomationVariant } from './meitAutomationVariants';
export {
  getMeiTAutomationConfig,
  getPancakeApiKeyForMeiTVariant,
  listMeiTAutomationVariantsForPanel,
  resolveMeiTAutomationVariant,
} from './meitAutomationVariants';

export type InvoiceShopKey = 'dpa' | 'meit';

export type ActiveAutomationConfig = {
  label: string;
  pancakeShopId: string;
  invoiceUrl: string;
  filledInvoicesStorageKey: string;
  meitVariant?: MeiTAutomationVariant;
};

export type InvoiceShopConfig = {
  key: InvoiceShopKey;
  label: string;
  mongoCollection: string;
  pancakeShopId: string;
  invoiceUrl: string;
  filledInvoicesStorageKey: string;
};

const SHOP_KEYS: InvoiceShopKey[] = ['dpa', 'meit'];

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveShopId(
  shopKey: InvoiceShopKey,
  shopSpecificEnv: string,
  fallbackEnv: string,
  defaultId: string
): string {
  return (
    trimString(process.env[shopSpecificEnv]) ||
    (shopKey === 'meit' ? trimString(process.env[fallbackEnv]) : '') ||
    defaultId
  );
}

function buildShopConfig(
  key: InvoiceShopKey,
  label: string,
  mongoCollection: string,
  shopIdEnv: string,
  defaultShopId: string,
  storageKey: string
): InvoiceShopConfig {
  const pancakeShopId = resolveShopId(
    key,
    shopIdEnv,
    'PANCAKE_SHOP_ID',
    defaultShopId
  );
  return {
    key,
    label,
    mongoCollection,
    pancakeShopId,
    invoiceUrl: `https://pos.pancake.vn/shop/${pancakeShopId}/e-invoices`,
    filledInvoicesStorageKey: storageKey,
  };
}

const SHOPS: Record<InvoiceShopKey, InvoiceShopConfig> = {
  dpa: buildShopConfig(
    'dpa',
    'DPA',
    'invoice_clients_dpa',
    'PANCAKE_DPA_SHOP_ID',
    '1942925579',
    'pancake.einvoice.filledRows.dpa'
  ),
  meit: buildShopConfig(
    'meit',
    'MeiT',
    'invoice_clients_meit',
    'PANCAKE_MEIT_SHOP_ID',
    '1021314908',
    'pancake.einvoice.filledRows.meit'
  ),
};

export function isInvoiceShopKey(value: unknown): value is InvoiceShopKey {
  return typeof value === 'string' && SHOP_KEYS.includes(value as InvoiceShopKey);
}

export function getInvoiceShopConfig(shopKey: InvoiceShopKey): InvoiceShopConfig {
  return SHOPS[shopKey];
}

export function resolveInvoiceShopKey(value: unknown): InvoiceShopKey {
  const key = trimString(value).toLowerCase();
  if (!isInvoiceShopKey(key)) {
    throw new Error(`Invalid shop. Use one of: ${SHOP_KEYS.join(', ')}`);
  }
  return key;
}

/** Active shop for WDIO child (set by automation runner). */
export function getActiveInvoiceShopKey(): InvoiceShopKey {
  const fromEnv = trimString(process.env.PANCAKE_ACTIVE_INVOICE_SHOP).toLowerCase();
  if (isInvoiceShopKey(fromEnv)) {
    return fromEnv;
  }
  return 'meit';
}

export function getActiveInvoiceShopConfig(): InvoiceShopConfig {
  return getInvoiceShopConfig(getActiveInvoiceShopKey());
}

/** WDIO / browser automation: MeiT tab uses Mode or Daily target; DPA uses shop config. */
export function getActiveAutomationConfig(): ActiveAutomationConfig {
  const shopKey = getActiveInvoiceShopKey();
  if (shopKey === 'dpa') {
    const shop = getInvoiceShopConfig('dpa');
    return {
      label: shop.label,
      pancakeShopId: shop.pancakeShopId,
      invoiceUrl: shop.invoiceUrl,
      filledInvoicesStorageKey: shop.filledInvoicesStorageKey,
    };
  }
  const variant = getActiveMeiTAutomationVariant();
  const meit = getMeiTAutomationConfig(variant);
  return {
    label: meit.label,
    pancakeShopId: meit.pancakeShopId,
    invoiceUrl: meit.invoiceUrl,
    filledInvoicesStorageKey: meit.filledInvoicesStorageKey,
    meitVariant: variant,
  };
}

/** Open API key for Pancake POS (webhook register, catalog, …). */
export function getPancakeApiKeyForShop(shopKey: InvoiceShopKey): string {
  const prefix = shopKey === 'dpa' ? 'PANCAKE_DPA' : 'PANCAKE_MEIT';
  return (
    trimString(process.env[`${prefix}_API_KEY`]) ||
    (shopKey === 'meit' ? trimString(process.env.PANCAKE_API_KEY) : '')
  );
}

export function getLoginCredentialsForShop(shopKey: InvoiceShopKey): {
  phone: string;
  password: string;
} {
  const prefix = shopKey === 'dpa' ? 'PANCAKE_DPA' : 'PANCAKE_MEIT';
  const phone =
    trimString(process.env[`${prefix}_LOGIN_PHONE`]) ||
    (shopKey === 'meit'
      ? trimString(process.env.PANCAKE_LOGIN_PHONE) ||
        trimString(process.env.PANCAKE_ACCOUNT)
      : '');
  const password =
    trimString(process.env[`${prefix}_LOGIN_PASSWORD`]) ||
    (shopKey === 'meit'
      ? trimString(process.env.PANCAKE_LOGIN_PASSWORD) ||
        trimString(process.env.PANCAKE_PASSWORD)
      : '');
  if (!phone || !password) {
    throw new Error(
      `Missing login for ${getInvoiceShopConfig(shopKey).label}: set ${prefix}_LOGIN_PHONE and ${prefix}_LOGIN_PASSWORD in .env` +
        (shopKey === 'meit'
          ? ' (or PANCAKE_LOGIN_PHONE / PANCAKE_LOGIN_PASSWORD)'
          : '')
    );
  }
  return { phone, password };
}
