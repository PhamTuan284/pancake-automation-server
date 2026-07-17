import https from 'https';

/**
 * Minimal JSON POST over the native https module (no extra dependency).
 * Shared by the Telegram and Zalo bot services.
 */
export function httpsPost(
  url: string,
  body: string
): Promise<{ ok: boolean; body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, body: data, status });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
