/**
 * Node 22+ enables loading synchronous ESM via `require()`. @wdio/cucumber-framework's
 * formatter is ESM with top-level await, so `require()` throws ERR_REQUIRE_ASYNC_MODULE.
 * @cucumber/cucumber@9 only falls back to dynamic `import()` on ERR_REQUIRE_ESM.
 * Passing `--no-require-module` restores the legacy error so Cucumber's fallback runs.
 * @see https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wdioCli = path.join(root, 'node_modules', '@wdio', 'cli', 'bin', 'wdio.js');
const major = Number(process.version.slice(1).split('.')[0]);

const nodeFlags = major >= 22 ? ['--no-require-module'] : [];

const result = spawnSync(
  process.execPath,
  [
    ...nodeFlags,
    wdioCli,
    'run',
    'wdio.conf.cjs',
    '--autoCompileOpts.autoCompile=false',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  }
);

process.exit(result.status === null ? 1 : result.status);
