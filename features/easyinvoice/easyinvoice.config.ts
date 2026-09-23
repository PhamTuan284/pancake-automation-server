export class EasyInvoiceConfigError extends Error {}

export type EasyInvoiceConfig = {
  baseUrl: string;
  username: string;
  password: string;
  taxCode: string;
  pattern: string;
  serial: string;
};

/** EasyInvoice (SoftDreams) API credentials — see EASYINVOICE_* in .env. */
export function getEasyInvoiceConfig(): EasyInvoiceConfig {
  const baseUrl = (process.env.EASYINVOICE_BASE_URL || 'https://api.softdreams.vn').trim().replace(/\/+$/, '');
  const username = process.env.EASYINVOICE_USERNAME?.trim();
  const password = process.env.EASYINVOICE_PASSWORD?.trim();
  const taxCode = process.env.EASYINVOICE_TAXCODE?.trim();
  const pattern = process.env.EASYINVOICE_PATTERN?.trim() ?? '';
  const serial = process.env.EASYINVOICE_SERIAL?.trim() ?? '';

  if (!username || !password || !taxCode) {
    throw new EasyInvoiceConfigError(
      'Thiếu EASYINVOICE_USERNAME / EASYINVOICE_PASSWORD / EASYINVOICE_TAXCODE trong biến môi trường.'
    );
  }

  return { baseUrl, username, password, taxCode, pattern, serial };
}
