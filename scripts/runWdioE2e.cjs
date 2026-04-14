/**
 * Node 22+ enables loading synchronous ESM via `require()`. @wdio/cucumber-framework's
 * formatter is ESM with top-level await, so `require()` throws ERR_REQUIRE_ASYNC_MODULE.
 * @cucumber/cucumber@9 only falls back to dynamic `import()` on ERR_REQUIRE_ESM.
 * Disabling `require(esm)` restores ERR_REQUIRE_ESM so Cucumber's fallback runs.
 *
 * The flag must live in NODE_OPTIONS, not only on the parent `node` argv: @wdio/local-runner
 * forks workers with `child.fork()`, which does not inherit ad-hoc CLI flags from the parent.
 *
 * Flag names differ across Node minors; we probe with NODE_OPTIONS (same mechanism workers use).
 * @see https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wdioCli = path.join(root, 'node_modules', '@wdio', 'cli', 'bin', 'wdio.js');

const major = Number(process.version.slice(1).split('.')[0]);

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} flag
 * @returns {NodeJS.ProcessEnv}
 */
function mergeNodeOptions(env, flag) {
  const next = { ...env };
  const cur = (next.NODE_OPTIONS ?? '').trim();
  if (cur.includes(flag)) {
    return next;
  }
  next.NODE_OPTIONS = cur ? `${flag} ${cur}` : flag;
  return next;
}

/** @returns {string} */
function pickDisableRequireModuleFlag() {
  if (!Number.isFinite(major) || major < 22) {
    return '';
  }
  const candidates = ['--no-require-module', '--no-experimental-require-module'];
  for (const flag of candidates) {
    const probeEnv = mergeNodeOptions(process.env, flag);
    const probe = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
      env: probeEnv,
    });
    if (probe.status === 0) {
      return flag;
    }
  }
  return '';
}

const disableFlag = pickDisableRequireModuleFlag();
const wdioEnv =
  disableFlag.length > 0
    ? mergeNodeOptions(process.env, disableFlag)
    : process.env;

const result = spawnSync(
  process.execPath,
  [wdioCli, 'run', 'wdio.conf.cjs', '--autoCompileOpts.autoCompile=false'],
  {
    cwd: root,
    stdio: 'inherit',
    env: wdioEnv,
  }
);

process.exit(result.status === null ? 1 : result.status);
