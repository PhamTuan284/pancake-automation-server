/**
 * Node 22+ enables loading synchronous ESM via `require()`. @wdio/cucumber-framework's
 * formatter is ESM with top-level await, so `require()` throws ERR_REQUIRE_ASYNC_MODULE.
 * @cucumber/cucumber@9 only falls back to dynamic `import()` on ERR_REQUIRE_ESM.
 * Disabling `require(esm)` restores ERR_REQUIRE_ESM so Cucumber's fallback runs.
 *
 * The CLI flag name changed across Node minors (`--no-require-module` vs
 * `--no-experimental-require-module`), so we probe instead of assuming.
 * @see https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wdioCli = path.join(root, 'node_modules', '@wdio', 'cli', 'bin', 'wdio.js');

const major = Number(process.version.slice(1).split('.')[0]);

/** @returns {string[]} */
function nodeFlagsToDisableRequireEsm() {
  if (!Number.isFinite(major) || major < 22) {
    return [];
  }
  const candidates = ['--no-require-module', '--no-experimental-require-module'];
  for (const flag of candidates) {
    const probe = spawnSync(process.execPath, [flag, '-e', 'process.exit(0)'], {
      encoding: 'utf8',
      stdio: 'ignore',
    });
    if (probe.status === 0) {
      return [flag];
    }
  }
  return [];
}

const nodeFlags = nodeFlagsToDisableRequireEsm();

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
