import { getEasyInvoiceConfig } from './easyinvoice.config';
import { buildAuthHeader } from './easyinvoice.signature';

export type EasyInvoiceApiResult = {
  httpStatus: number;
  body: unknown;
};

/** Every resource from the EasyInvoice integration doc (section IV), keyed by a stable operation id. */
export const EASYINVOICE_OPERATIONS = {
  importAndPublishInvoice: '/api/publish/importAndPublishInvoice',
  replaceInvoice: '/api/business/replaceInvoice',
  adjustInvoice: '/api/business/adjustInvoice',
  checkInvoiceState: '/api/publish/checkInvoiceState',
  registerDeclaration: '/api/declaration/registerAndPublish',
  searchDeclaration: '/api/declaration/search',
  declarationDetail: '/api/declaration/get_detail',
} as const;

export type EasyInvoiceOperation = keyof typeof EASYINVOICE_OPERATIONS;

export function isEasyInvoiceOperation(value: unknown): value is EasyInvoiceOperation {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EASYINVOICE_OPERATIONS, value);
}

export async function callEasyInvoice(
  path: string,
  payload: Record<string, unknown>
): Promise<EasyInvoiceApiResult> {
  const config = getEasyInvoiceConfig();
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authentication: buildAuthHeader(config, 'POST'),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON response (e.g. an HTML error page) — return the raw text.
  }

  return { httpStatus: res.status, body };
}

/**
 * Connectivity/auth smoke test: checkInvoiceState with a throwaway ikey.
 * Any JSON reply from the API (even a "not found" business result) confirms the
 * base URL, signature and credentials are accepted.
 */
export async function testConnection(): Promise<EasyInvoiceApiResult> {
  const config = getEasyInvoiceConfig();
  return callEasyInvoice(EASYINVOICE_OPERATIONS.checkInvoiceState, {
    Pattern: config.pattern,
    Serial: config.serial,
    Ikeys: [`meit-test-${Date.now()}`],
  });
}
