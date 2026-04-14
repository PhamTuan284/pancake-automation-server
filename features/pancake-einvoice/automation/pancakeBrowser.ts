import http from 'http';
import net from 'net';
import { spawn, type ChildProcess } from 'child_process';
import { remote } from 'webdriverio';
import type { WdioBrowser } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const chromeEnv = require('./pancake-chrome-env.cjs') as {
  chromedriverExecutablePath: () => string;
  remoteCapabilities: () => Record<string, unknown>;
};

function getFreeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p =
        typeof addr === 'object' && addr !== null && 'port' in addr
          ? (addr as net.AddressInfo).port
          : null;
      s.close(() => (p != null ? resolve(p) : reject(new Error('No port'))));
    });
    s.on('error', reject);
  });
}

function waitForChromeDriverStatus(
  port: number,
  timeoutMs = 25000
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function ping() {
      const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(undefined);
          return;
        }
        schedule();
      });
      req.on('error', () => schedule());
      req.setTimeout(2000, () => {
        req.destroy();
        schedule();
      });
    }
    function schedule() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`ChromeDriver not ready on port ${port}`));
        return;
      }
      setTimeout(ping, 200);
    }
    ping();
  });
}

async function startChromeDriverOnFreePort(): Promise<{
  port: number;
  child: ChildProcess;
}> {
  const port = await getFreeTcpPort();
  const chromedriverPath = chromeEnv.chromedriverExecutablePath();
  const child = spawn(chromedriverPath, [`--port=${port}`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForChromeDriverStatus(port);
  return { port, child };
}

export type PancakeBrowserSession = {
  browser: WdioBrowser;
  driverChild: ChildProcess;
  port: number;
};

/**
 * Start ChromeDriver on a free port and attach WebdriverIO (same capabilities as WDIO E2E).
 */
export async function connectPancakeBrowser(): Promise<PancakeBrowserSession> {
  const { port, child } = await startChromeDriverOnFreePort();
  const browser = (await remote({
    hostname: 'localhost',
    port,
    path: '/',
    capabilities: chromeEnv.remoteCapabilities(),
    connectionRetryCount: 3,
    connectionRetryTimeout: 120_000,
  })) as WdioBrowser;
  return { browser, driverChild: child, port };
}

export async function disposePancakeBrowserSession(
  session: PancakeBrowserSession
): Promise<void> {
  try {
    await session.browser.deleteSession();
  } catch {
    /* ignore */
  }
  try {
    session.driverChild.kill();
  } catch {
    /* ignore */
  }
}
