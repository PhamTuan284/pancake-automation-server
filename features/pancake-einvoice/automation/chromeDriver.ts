import http from 'http';
import net from 'net';
import { spawn, type ChildProcess } from 'child_process';
import chromedriver from 'chromedriver';

/** Avoid binding to a stale ChromeDriver from a previous crashed run. */
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

/**
 * Start ChromeDriver on a free port and return { port, child }.
 * Caller must kill child on exit.
 */
export async function startChromeDriver(): Promise<{
  port: number;
  child: ChildProcess;
}> {
  const port = await getFreeTcpPort();
  const child = spawn(chromedriver.path, [`--port=${port}`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForChromeDriverStatus(port);
  return { port, child };
}
