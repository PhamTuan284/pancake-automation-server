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
 * Run WDIO via `node …/wdio.js run wdio.conf.cjs` (not `npm run`), because on Windows
 * spawning `npm.cmd` without a shell often fails with `spawn EINVAL` on Node 20+.
 */
function runWdioE2e(): Promise<void> {
  bundleWdioStepsSync();

  const wdioCli = path.join(
    serverRoot,
    'node_modules',
    '@wdio',
    'cli',
    'bin',
    'wdio.js'
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wdioCli, 'run', 'wdio.conf.cjs'], {
      cwd: serverRoot,
      env: process.env,
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
          `wdio run wdio.conf.cjs exited with code ${code ?? 'unknown'}\n${tail}`
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
