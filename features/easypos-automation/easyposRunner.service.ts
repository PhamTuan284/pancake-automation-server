import { spawn } from 'child_process';
import path from 'path';
import { acquireAutomationLock, isAnyAutomationRunning, releaseAutomationLock } from '../../common/automationLock';
import { killChildProcessTree } from '../../common/killProcessTree';

const serverRoot = path.join(__dirname, '..', '..');
const tsxCli = path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const scriptPath = path.join(serverRoot, 'scripts', 'fixEasyposCustomerNames.ts');

/** True while this or any other browser automation (e.g. Pancake e-invoice) is running. */
export function isEasyposAutomationRunning(): boolean {
  return isAnyAutomationRunning();
}

function runChild(apply: boolean): Promise<{ output: string }> {
  const args = [tsxCli, scriptPath, ...(apply ? ['--apply'] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: serverRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group so we can SIGKILL the whole tree (chromedriver, Chrome) on exit —
      // otherwise those grandchildren can outlive this child and leak RAM run after run.
      detached: true,
    });

    const chunks: Buffer[] = [];
    const push = (d: Buffer) => chunks.push(d);
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);

    child.on('error', (err) => reject(err));

    child.on('exit', (code) => {
      killChildProcessTree(child);
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) {
        resolve({ output });
        return;
      }
      reject(new Error(output.slice(-6000) || `Process exited with code ${code}`));
    });
  });
}

/**
 * Runs `scripts/fixEasyposCustomerNames.ts` as a child process (spawned via `node <tsx-cli>`,
 * not `npx`/`npm run`, to avoid Windows `spawn EINVAL` on .cmd shims — same approach as
 * `runWdioE2e.cjs`). Resolves with the combined stdout/stderr once the process exits.
 *
 * Shares `common/automationLock` with the Pancake e-invoice WDIO runner — both spawn Chrome +
 * chromedriver, and running two at once on a small server would starve both.
 *
 * The lock is released in a `finally` wrapping the whole run (not just inside the child's event
 * handlers) — a prod incident showed `spawn()` can throw synchronously under resource pressure
 * (observed: `EAGAIN` when the container couldn't fork), before any event handler was even
 * attached, which previously left the lock stuck forever (`child.on(...)` releasing it was the
 * only path, and it was never reached).
 */
export async function runFixEasyposCustomerNames(apply: boolean): Promise<{ output: string }> {
  acquireAutomationLock('easypos-customer-names');
  try {
    return await runChild(apply);
  } finally {
    releaseAutomationLock();
  }
}
