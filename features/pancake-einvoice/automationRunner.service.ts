import { execFileSync, spawn } from 'child_process';
import path from 'path';

/** WDIO spec for the full e-invoice table flow (API + webhook + `npm run automation`). */
export const WDIO_SPEC_EINVOICE_AUTOMATION =
  './wdio/features/pancake-einvoice-automation.feature';

let e2eRunning = false;

/** True while a WDIO child process is running (any spec). */
export function isAutomationRunning(): boolean {
  return e2eRunning;
}

const serverRoot = path.join(__dirname, '..', '..');

/**
 * WDIO's ConfigParser runs `loadAutoCompilers` *before* merging `wdio.conf.*`, so the
 * default `autoCompile: true` still enables ts-node and sets `WDIO_LOAD_TS_NODE=1`
 * unless we pass `--autoCompileOpts.autoCompile=false` on the CLI. Also strip any
 * inherited ts-node hooks so workers do not `require()` ESM formatters through ts-node.
 * Node 22+ `require(esm)` is disabled for WDIO via `scripts/runWdioE2e.cjs` (sets NODE_OPTIONS so
 * forked WDIO workers inherit the flag).
 */
function envForWdioChild(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.WDIO_LOAD_TS_NODE;
  const nodeOptions = env.NODE_OPTIONS;
  if (typeof nodeOptions === 'string' && nodeOptions.length > 0) {
    const cleaned = nodeOptions
      .replace(/\s*--loader\s+ts-node\/esm\/transpile-only\s*/g, ' ')
      .replace(/\s*-r\s+ts-node\/register\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length === 0) {
      delete env.NODE_OPTIONS;
    } else {
      env.NODE_OPTIONS = cleaned;
    }
  }
  return env;
}

function bundleWdioStepsSync(): void {
  const tsxMjs = path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const bundleScript = path.join(serverRoot, 'scripts', 'bundleWdioSteps.ts');
  execFileSync(process.execPath, [tsxMjs, bundleScript], {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

/**
 * Run WDIO via `node scripts/runWdioE2e.cjs` (not `npm run`), because on Windows spawning
 * `npm.cmd` without a shell often fails with `spawn EINVAL` on Node 20+.
 * @param extraWdioArgs e.g. `['--spec', WDIO_SPEC_EINVOICE_AUTOMATION]` to run one feature.
 */
function runWdioE2e(extraWdioArgs: string[] = []): Promise<void> {
  bundleWdioStepsSync();

  const launcher = path.join(serverRoot, 'scripts', 'runWdioE2e.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, ...extraWdioArgs], {
      cwd: serverRoot,
      env: envForWdioChild(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const push = (d: Buffer) => {
      chunks.push(d);
      process.stdout.write(d);
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const tail = Buffer.concat(chunks).toString('utf8').slice(-6000);
      reject(
        new Error(
          `E2E runner (scripts/runWdioE2e.cjs) exited with code ${code ?? 'unknown'}\n${tail}`
        )
      );
    });
  });
}

/**
 * Run Cucumber/WDIO. Pass `['--spec', WDIO_SPEC_EINVOICE_AUTOMATION]` for invoice automation only.
 */
export async function triggerE2eTestRun(
  extraWdioArgs: string[] = []
): Promise<void> {
  if (e2eRunning) {
    throw new Error('E2E test already running');
  }
  e2eRunning = true;
  try {
    await runWdioE2e(extraWdioArgs);
  } finally {
    e2eRunning = false;
  }
}
