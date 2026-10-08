import { spawn } from 'child_process';
import path from 'path';

const serverRoot = path.join(__dirname, '..', '..');
const tsxCli = path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const scriptPath = path.join(serverRoot, 'scripts', 'fixEasyposCustomerNames.ts');

let running = false;

export function isEasyposAutomationRunning(): boolean {
  return running;
}

/**
 * Runs `scripts/fixEasyposCustomerNames.ts` as a child process (spawned via `node <tsx-cli>`,
 * not `npx`/`npm run`, to avoid Windows `spawn EINVAL` on .cmd shims — same approach as
 * `runWdioE2e.cjs`). Resolves with the combined stdout/stderr once the process exits.
 */
export function runFixEasyposCustomerNames(apply: boolean): Promise<{ output: string }> {
  if (running) {
    return Promise.reject(new Error('EasyPOS automation already running'));
  }
  running = true;

  const args = [tsxCli, scriptPath, ...(apply ? ['--apply'] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: serverRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    const push = (d: Buffer) => chunks.push(d);
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);

    child.on('error', (err) => {
      running = false;
      reject(err);
    });

    child.on('exit', (code) => {
      running = false;
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) {
        resolve({ output });
        return;
      }
      reject(new Error(output.slice(-6000) || `Process exited with code ${code}`));
    });
  });
}
