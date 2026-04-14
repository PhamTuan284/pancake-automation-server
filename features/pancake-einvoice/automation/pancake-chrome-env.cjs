'use strict';

/**
 * Shared Chrome/Chromium options for WDIO config and programmatic `webdriverio.remote()`.
 * Callers must load `.env` first (e.g. `wdio.conf.cjs` dotenv, or `import '../loadServerEnv'`).
 */

function onRailway() {
  return Boolean(process.env.RAILWAY_ENVIRONMENT);
}

function isHeadless() {
  return (
    onRailway() ||
    process.env.E2E_HEADLESS === '1' ||
    process.env.CI === 'true' ||
    process.env.AUTOMATION_HEADLESS === '1'
  );
}

function chromeBinary() {
  const b = process.env.CHROME_BIN || process.env.CHROMIUM_BIN;
  return typeof b === 'string' && b.length > 0 ? b : '';
}

function chromeArgs() {
  const headless = isHeadless();
  const headlessArgs = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1920,1080',
  ];
  const headedArgs = [
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--no-first-run',
    '--start-maximized',
    '--incognito',
  ];
  return headless ? headlessArgs : headedArgs;
}

function chromeOptionsForWdio() {
  const binary = chromeBinary();
  return {
    ...(binary ? { binary } : {}),
    args: [...chromeArgs()],
  };
}

function chromedriverExecutablePath() {
  if (process.env.CHROMEDRIVER_PATH) {
    return process.env.CHROMEDRIVER_PATH;
  }
  return require('chromedriver').path;
}

function remoteCapabilities() {
  return {
    browserName: 'chrome',
    'goog:chromeOptions': chromeOptionsForWdio(),
  };
}

module.exports = {
  onRailway,
  isHeadless,
  chromeBinary,
  chromeArgs,
  chromeOptionsForWdio,
  chromedriverExecutablePath,
  remoteCapabilities,
};
