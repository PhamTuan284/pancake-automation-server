/**
 * Cross-feature mutex for browser automations (Pancake e-invoice WDIO run, EasyPOS customer-name
 * fix, ...). Each spawns its own Chrome + chromedriver; running two at once on a small server
 * starves both for CPU/RAM and causes flaky timeouts in whichever one is slower to render
 * (e.g. Pancake's e-invoice modal never appearing in time). Only one may hold the lock at once,
 * regardless of which feature acquired it.
 */
let running = false;
let label: string | null = null;

export function isAnyAutomationRunning(): boolean {
  return running;
}

export function runningAutomationLabel(): string | null {
  return label;
}

/** Throws if the lock is already held by any automation. */
export function acquireAutomationLock(nextLabel: string): void {
  if (running) {
    throw new Error(`Automation already running (${label ?? 'unknown'})`);
  }
  running = true;
  label = nextLabel;
}

export function releaseAutomationLock(): void {
  running = false;
  label = null;
}
