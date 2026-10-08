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

/**
 * Runs `scripts/fixEasyposCustomerNames.ts` as a child process (spawned via `node <tsx-cli>`,
 * not `npx`/`npm run`, to avoid Windows `spawn EINVAL` on .cmd shims — same approach as
 * `runWdioE2e.cjs`). Resolves with the combined stdout/stderr once the process exits.
 *
 * Shares `common/automationLock` with the Pancake e-invoice WDIO runner — both spawn Chrome +
 * chromedriver, and running two at once on a small server would starve both. (A prod incident
 * initially suspected to be this turned out to be unrelated — see `killProcessTree.ts` — but
 * the lock is still correct to keep: two concurrent Chrome sessions on a small container is a
 * real risk regardless.)
 */
export function runFixEasyposCustomerNames(apply: boolean): Promise<{ output: string }> {
  try {
    acquireAutomationLock('easypos-customer-names');
  } catch {
    return Promise.reject(new Error('EasyPOS automation already running'));
  }

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

    child.on('error', (err) => {
      releaseAutomationLock();
      reject(err);
    });

    child.on('exit', (code) => {
      killChildProcessTree(child);
      releaseAutomationLock();
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) {
        resolve({ output });
        return;
      }
      reject(new Error(output.slice(-6000) || `Process exited with code ${code}`));
    });
  });
}
