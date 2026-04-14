import { loginToPancake } from '../../../features/pancake-einvoice/automation/pancakeLogin';
import type { WdioBrowser } from '../../../features/pancake-einvoice/automation/types';
import Page from './page';

/**
 * Thin page object: reuses production login automation so behaviour stays single-sourced.
 */
export default class PancakeLoginPage extends Page {
  async loginThroughToEInvoices() {
    await loginToPancake(this.browser as WdioBrowser);
  }
}
