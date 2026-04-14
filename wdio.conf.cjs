/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

/**
 * Use `.cjs` (not `.ts`) so @wdio/cli does not re-exec with ts-node for the config file.
 * You must still pass `--autoCompileOpts.autoCompile=false` on the CLI: ConfigParser runs
 * loadAutoCompilers *before* reading this file, so the default autoCompile:true would
 * otherwise set WDIO_LOAD_TS_NODE and break Cucumber formatters on Node 22.
 */
const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);
const headless =
  onRailway ||
  process.env.E2E_HEADLESS === '1' ||
  process.env.CI === 'true';

const chromeBinary = process.env.CHROME_BIN || process.env.CHROMIUM_BIN;

const chromeArgsHeadless = [
  '--headless=new',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--window-size=1920,1080',
];

const chromeArgsHeaded = [
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--no-first-run',
  '--start-maximized',
  '--incognito',
];

const chromeArgs = headless ? [...chromeArgsHeadless] : [...chromeArgsHeaded];

function chromedriverCustomPath() {
  if (process.env.CHROMEDRIVER_PATH) {
    return process.env.CHROMEDRIVER_PATH;
  }
  return require('chromedriver').path;
}

exports.config = {
  runner: 'local',
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
