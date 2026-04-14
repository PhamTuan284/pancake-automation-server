import { execFileSync, spawn } from 'child_process';
import path from 'path';
import { runPancakeFlow } from './automation/runPancakeFlow';

let running = false;
let e2eRunning = false;

export function isAutomationRunning(): boolean {
  return running;
}

export async function triggerAutomationRun(): Promise<void> {
  if (running) {
    throw new Error('Automation already running');
  }
  if (e2eRunning) {
    throw new Error('E2E test is already running');
  }
  running = true;
  try {
    await runPancakeFlow();
  } finally {
    running = false;
  }
}

const serverRoot = path.join(__dirname, '..', '..');

/**
 * WDIO's ConfigParser runs `loadAutoCompilers` *before* merging `wdio.conf.*`, so the
 * default `autoCompile: true` still enables ts-node and sets `WDIO_LOAD_TS_NODE=1`
 * unless we pass `--autoCompileOpts.autoCompile=false` on the CLI. Also strip any
 * inherited ts-node hooks so workers do not `require()` ESM formatters through ts-node.
 * Node 22+ `require(esm)` is disabled for WDIO via `scripts/runWdioE2e.cjs` (`--no-require-module`).
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
 */
function runWdioE2e(): Promise<void> {
  bundleWdioStepsSync();

  const launcher = path.join(serverRoot, 'scripts', 'runWdioE2e.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher], {
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

export async function triggerE2eTestRun(): Promise<void> {
  if (e2eRunning) {
    throw new Error('E2E test already running');
  }
  if (running) {
    throw new Error('Automation already running');
  }
  e2eRunning = true;
  try {
    await runWdioE2e();
  } finally {
    e2eRunning = false;
  }
}
