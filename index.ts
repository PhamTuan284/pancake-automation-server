import './features/pancake-einvoice/loadServerEnv';
import http from 'http';
import { createApp } from './createApp';

const app = createApp();

/** Default 4001 so dev works when another app already uses 4000; override with PORT. */
const preferredPort = Number(process.env.PORT) || 4001;
const maxPort = preferredPort + 20;

const server = http.createServer(app);
let port = preferredPort;

server.on('listening', () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`Pancake automation API: http://localhost:${bound}`);
  if (bound !== preferredPort) {
    console.warn(
      `API bound to ${bound} (preferred ${preferredPort} was busy). Point the UI proxy at this port, e.g. PowerShell:\n` +
        `  $env:PANCAKE_API_PORT="${bound}"; npm run dev\n` +
        `  (from folder pancake-automation-ui)`
    );
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') {
    console.error(err);
    process.exit(1);
  }
  if (port >= maxPort) {
    console.error(
      `No free port between ${preferredPort} and ${maxPort}. Stop the process using port ${preferredPort} or set PORT to an open port.`
    );
    process.exit(1);
  }
  console.warn(`Port ${port} in use, trying ${port + 1}…`);
  port += 1;
  server.listen(port);
});

server.listen(port);
