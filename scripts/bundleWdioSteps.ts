/**
 * Bundles Cucumber step definitions + app automation into one CJS file so WDIO
 * workers do not need ts-node (avoids require() vs Cucumber ESM on Linux).
 */
import path from 'path';
import { buildSync } from 'esbuild';

const root = path.join(__dirname, '..');
const entry = path.join(
  root,
  'wdio',
  'features',
  'step-definitions',
  'pancake-login.steps.ts'
);
const outfile = path.join(
  root,
  'wdio',
  'features',
  'step-definitions',
  'pancake-login.bundled.cjs'
);

buildSync({
  absWorkingDir: root,
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  packages: 'external',
  logLevel: 'warning',
});

console.log('Wrote', path.relative(root, outfile));
