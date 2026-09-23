import crypto from 'crypto';
import type { EasyInvoiceConfig } from './easyinvoice.config';

/**
 * EasyInvoice (SoftDreams) request signing: signature = base64(MD5(method + timestamp + nonce)),
 * sent as `Authentication: signature:nonce:timestamp:username:password:taxcode`.
 * Docs: https://docs.google.com/document/d/1sp0Vw_0x_McPANQlyQrpcMFnmT-_tFx0
 */
export function buildAuthHeader(config: EasyInvoiceConfig, method: 'GET' | 'POST'): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const signature = crypto
    .createHash('md5')
    .update(`${method}${timestamp}${nonce}`)
    .digest('base64');

  return [signature, nonce, timestamp, config.username, config.password, config.taxCode].join(':');
}
