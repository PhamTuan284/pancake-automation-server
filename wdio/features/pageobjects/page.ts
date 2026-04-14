import { browser as wdioBrowser } from '@wdio/globals';

/**
 * Base helpers shared by Pancake page objects (wdio-server style base page).
 */
export default class Page {
  protected get browser() {
    return wdioBrowser;
  }
}
