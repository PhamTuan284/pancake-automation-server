import { getEasyInvoiceConfig } from './easyinvoice.config';
import { buildAuthHeader } from './easyinvoice.signature';

export type EasyInvoiceApiResult = {
  httpStatus: number;
  body: unknown;
};

async function callEasyInvoice(path: string, payload: Record<string, unknown>): Promise<EasyInvoiceApiResult> {
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
    // API returned non-JSON (e.g. an HTML error page) — surface the raw text.
  }

  return { httpStatus: res.status, body };
}

/**
 * Connectivity/auth smoke test: calls checkInvoiceState with a throwaway ikey.
 * The API replying at all (even with a "not found" business error) confirms the
 * base URL, signature and credentials are accepted — a 401/403 means auth is wrong.
 */
export async function testConnection(): Promise<EasyInvoiceApiResult> {
  const config = getEasyInvoiceConfig();
  return callEasyInvoice('/api/publish/checkInvoiceState', {
    Pattern: config.pattern,
    Serial: config.serial,
    Ikeys: [`meit-test-${Date.now()}`],
  });
}

export async function checkInvoiceState(params: {
  pattern: string;
  serial: string;
  ikey: string;
}): Promise<EasyInvoiceApiResult> {
  return callEasyInvoice('/api/publish/checkInvoiceState', {
    Pattern: params.pattern,
    Serial: params.serial,
    Ikeys: [params.ikey],
  });
}
