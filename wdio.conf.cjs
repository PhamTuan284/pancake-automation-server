/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const chromeEnv = require('./features/pancake-einvoice/automation/pancake-chrome-env.cjs');

/**
 * Use `.cjs` (not `.ts`) so @wdio/cli does not re-exec with ts-node for the config file.
 * You must still pass `--autoCompileOpts.autoCompile=false` on the CLI: ConfigParser runs
 * loadAutoCompilers *before* reading this file, so the default autoCompile:true would
 * otherwise set WDIO_LOAD_TS_NODE and break Cucumber formatters on Node 22.
 *
 * Chrome options are shared with programmatic automation via `pancake-chrome-env.cjs`.
 */
exports.config = {
  runner: 'local',
  autoCompileOpts: {
    autoCompile: false,
  },
  specs: ['./wdio/features/**/*.feature'],
  exclude: [],
  maxInstances: chromeEnv.onRailway() ? 1 : 10,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': chromeEnv.chromeOptionsForWdio(),
    },
  ],
  logLevel: chromeEnv.onRailway() ? 'info' : 'warn',
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
        chromedriverCustomPath: chromeEnv.chromedriverExecutablePath(),
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
