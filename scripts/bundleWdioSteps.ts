/**
 * Bundles Cucumber step definitions into CJS so WDIO workers do not need ts-node.
 */
import path from 'path';
import { buildSync } from 'esbuild';

const root = path.join(__dirname, '..');

const bundles: { entry: string; outfile: string }[] = [
  {
    entry: 'wdio/features/step-definitions/pancake-login.steps.ts',
    outfile: 'wdio/features/step-definitions/pancake-login.bundled.cjs',
  },
  {
    entry: 'wdio/features/step-definitions/pancake-einvoice-automation.steps.ts',
    outfile:
      'wdio/features/step-definitions/pancake-einvoice-automation.bundled.cjs',
  },
];

for (const { entry, outfile } of bundles) {
  const entryAbs = path.join(root, entry);
  const outfileAbs = path.join(root, outfile);
  buildSync({
    absWorkingDir: root,
    entryPoints: [entryAbs],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: outfileAbs,
    packages: 'external',
    logLevel: 'warning',
  });
  console.log('Wrote', path.relative(root, outfileAbs));
}
