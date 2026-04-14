import path from 'path';
import dotenv from 'dotenv';
import type { Options } from '@wdio/types';

dotenv.config({ path: path.join(__dirname, '.env') });

/** Same signal as wdio-server: fewer workers on Railway. */
const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);

const headless =
  onRailway ||
  process.env.E2E_HEADLESS === '1' ||
  process.env.CI === 'true';

const chromeBinary = process.env.CHROME_BIN || process.env.CHROMIUM_BIN;

/**
 * Headless / container Chrome flags — aligned with
 * https://github.com/nguyencongcuong/wdio-server/blob/master/wdio/wdio.conf.ts
 */
const chromeArgsHeadless = [
  '--headless=new',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--window-size=1920,1080',
] as const;

/** Local headed runs */
const chromeArgsHeaded = [
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--no-first-run',
  '--start-maximized',
  '--incognito',
] as const;

const chromeArgs = headless
  ? [...chromeArgsHeadless]
  : [...chromeArgsHeaded];

function chromedriverCustomPath(): string {
  if (process.env.CHROMEDRIVER_PATH) {
    return process.env.CHROMEDRIVER_PATH;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('chromedriver').path as string;
}

export const config: Options.Testrunner = {
  runner: 'local',
  // Do not set WDIO_LOAD_TS_NODE (avoids ts-node in workers + broken require() of Cucumber ESM on Linux).
  autoCompileOpts: {
    autoCompile: false,
  },
  specs: ['./wdio/features/**/*.feature'],
  exclude: [],
  maxInstances: onRailway ? 1 : 10,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        ...(chromeBinary ? { binary: chromeBinary } : {}),
        args: [...chromeArgs],
      },
    },
  ],
  logLevel: onRailway ? 'info' : 'warn',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  framework: 'cucumber',
  reporters: ['spec'],
  services: [
    [
      'chromedriver',
      {
        chromedriverCustomPath: chromedriverCustomPath(),
      },
    ],
  ],
  cucumberOpts: {
    require: ['./wdio/features/step-definitions/pancake-login.bundled.cjs'],
    backtrace: false,
    failFast: false,
    snippets: true,
    source: true,
    strict: false,
    tagExpression: '',
    timeout: 600_000,
    ignoreUndefinedDefinitions: false,
    publishQuiet: true,
  },
};
