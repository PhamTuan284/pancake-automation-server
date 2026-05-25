/** Pancake POS targets within the MeiT tab (shared Mongo customer list). */
export type MeiTAutomationVariant = 'mode' | 'daily';

const VARIANTS: MeiTAutomationVariant[] = ['mode', 'daily'];

export type MeiTAutomationConfig = {
  variant: MeiTAutomationVariant;
  label: string;
  pancakeShopId: string;
  invoiceUrl: string;
  filledInvoicesStorageKey: string;
};

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveMeiTModeShopId(): string {
  return (
    trimString(process.env.PANCAKE_MEIT_MODE_SHOP_ID) ||
    trimString(process.env.PANCAKE_MEIT_SHOP_ID) ||
    trimString(process.env.PANCAKE_SHOP_ID) ||
    '1021314908'
  );
}

function resolveMeiTDailyShopId(): string {
  return trimString(process.env.PANCAKE_MEIT_DAILY_SHOP_ID);
}

function buildConfig(
  variant: MeiTAutomationVariant,
  label: string,
  pancakeShopId: string,
  storageSuffix: string
): MeiTAutomationConfig {
  return {
    variant,
    label,
    pancakeShopId,
    invoiceUrl: `https://pos.pancake.vn/shop/${pancakeShopId}/e-invoices`,
    filledInvoicesStorageKey: `pancake.einvoice.filledRows.meit.${storageSuffix}`,
  };
}

export function isMeiTAutomationVariant(
  value: unknown
): value is MeiTAutomationVariant {
  return typeof value === 'string' && VARIANTS.includes(value as MeiTAutomationVariant);
}

export function resolveMeiTAutomationVariant(value: unknown): MeiTAutomationVariant {
  const key = trimString(value).toLowerCase();
  if (!isMeiTAutomationVariant(key)) {
    throw new Error(`Invalid MeiT variant. Use one of: ${VARIANTS.join(', ')}`);
  }
  return key;
}

export function getActiveMeiTAutomationVariant(): MeiTAutomationVariant {
  const fromEnv = trimString(process.env.PANCAKE_ACTIVE_MEIT_VARIANT).toLowerCase();
  if (isMeiTAutomationVariant(fromEnv)) {
    return fromEnv;
  }
  return 'mode';
}

export function getMeiTAutomationConfig(
  variant: MeiTAutomationVariant
): MeiTAutomationConfig {
  if (variant === 'daily') {
    const pancakeShopId = resolveMeiTDailyShopId();
    if (!pancakeShopId) {
      throw new Error(
        'Missing MeiT Daily shop id: set PANCAKE_MEIT_DAILY_SHOP_ID in .env'
      );
    }
    return buildConfig('daily', 'MeiT Daily', pancakeShopId, 'daily');
  }
  const pancakeShopId = resolveMeiTModeShopId();
  return buildConfig('mode', 'MeiT Mode', pancakeShopId, 'mode');
}

/** Open API key for a MeiT Mode / Daily Pancake shop. */
export function getPancakeApiKeyForMeiTVariant(
  variant: MeiTAutomationVariant
): string {
  if (variant === 'daily') {
    return trimString(process.env.PANCAKE_MEIT_DAILY_API_KEY);
  }
  return (
    trimString(process.env.PANCAKE_MEIT_MODE_API_KEY) ||
    trimString(process.env.PANCAKE_MEIT_API_KEY) ||
    trimString(process.env.PANCAKE_API_KEY)
  );
}

export type MeiTAutomationPanelEntry = MeiTAutomationConfig & {
  configured: boolean;
};

export function listMeiTAutomationVariantsForPanel(): MeiTAutomationPanelEntry[] {
  const mode = { ...getMeiTAutomationConfig('mode'), configured: true };
  const dailyShopId = resolveMeiTDailyShopId();
  if (!dailyShopId) {
    return [
      mode,
      {
        variant: 'daily',
        label: 'MeiT Daily',
        pancakeShopId: '',
        invoiceUrl: '',
        filledInvoicesStorageKey: '',
        configured: false,
      },
    ];
  }
  return [mode, { ...getMeiTAutomationConfig('daily'), configured: true }];
}
