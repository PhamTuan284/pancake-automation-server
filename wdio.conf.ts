import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

export const config = {
  runner: 'local',
  specs: ['./wdio/features/**/*.feature'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          '--start-maximized',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--no-first-run',
          '--incognito',
        ],
      },
    },
  ],
  logLevel: 'warn' as const,
  framework: 'cucumber',
  reporters: ['spec'],
  services: [
    [
      'chromedriver',
      {
        chromedriverCustomPath: require('chromedriver').path,
      },
    ],
  ],
  cucumberOpts: {
    require: ['./wdio/features/step-definitions/**/*.ts'],
    timeout: 600_000,
    publishQuiet: true,
  },
};
