/**
 * Cross-feature mutex for browser automations (Pancake e-invoice WDIO run, EasyPOS customer-name
 * fix, ...). Each spawns its own Chrome + chromedriver; running two at once on a small server
 * starves both for CPU/RAM and causes flaky timeouts in whichever one is slower to render
 * (e.g. Pancake's e-invoice modal never appearing in time). Only one may hold the lock at once,
 * regardless of which feature acquired it.
 *
 * Also self-heals: if whatever acquired the lock never calls release (observed once in prod —
 * exact cause not pinned down, but a normal run never takes anywhere near this long), a watchdog
 * force-releases it after `maxRuntimeMs` so a single hung run can't permanently block every
 * automation feature until someone manually calls the reset endpoint.
 */
const DEFAULT_MAX_RUNTIME_MS = 10 * 60 * 1000; // 10 minutes — generous vs. real runs (~1-2 min)

let running = false;
let label: string | null = null;
let watchdog: NodeJS.Timeout | null = null;

export function isAnyAutomationRunning(): boolean {
  return running;
}

export function runningAutomationLabel(): string | null {
  return label;
}

/** Throws if the lock is already held by any automation. */
export function acquireAutomationLock(
  nextLabel: string,
  maxRuntimeMs: number = DEFAULT_MAX_RUNTIME_MS
): void {
  if (running) {
    throw new Error(`Automation already running (${label ?? 'unknown'})`);
  }
  running = true;
  label = nextLabel;
  watchdog = setTimeout(() => {
    console.error(
      `[automationLock] "${label}" exceeded ${maxRuntimeMs}ms without releasing — force-releasing stuck lock.`
    );
    releaseAutomationLock();
  }, maxRuntimeMs);
  watchdog.unref();
}

export function releaseAutomationLock(): void {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
  running = false;
  label = null;
}
