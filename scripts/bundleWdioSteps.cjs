/**
 * Bundles Cucumber step definitions into CJS so WDIO workers do not need ts-node.
 */
const path = require('path');
const { build } = require('esbuild');

const root = path.join(__dirname, '..');

const bundles = [
  {
    entry: 'wdio/features/step-definitions/pancake-login.steps.ts',
    outfile: 'wdio/features/step-definitions/pancake-login.bundled.cjs',
  },
  {
    entry: 'wdio/features/step-definitions/pancake-einvoice-automation.steps.ts',
    outfile: 'wdio/features/step-definitions/pancake-einvoice-automation.bundled.cjs',
  },
];

(async () => {
  for (const { entry, outfile } of bundles) {
    const entryAbs = path.join(root, entry);
    const outfileAbs = path.join(root, outfile);
    await build({
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
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
