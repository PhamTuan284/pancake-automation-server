import type { spawn } from 'child_process';

/**
 * Kills the whole process group for a `detached: true` child, not just the direct process —
 * `child.kill()` alone never reaches grandchildren (chromedriver, Chrome itself), so without
 * this they can be left running indefinitely after every automation run, accumulating RAM on
 * the server over time. `-pid` targets the process group on Linux/macOS; falls back to killing
 * just the direct child on Windows (no negative-PID group kill) for local dev.
 */
export function killChildProcessTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}
