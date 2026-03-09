// Post-build script: runs after `astro build` (which includes the @astrojs/vercel adapter).
// The adapter writes .vercel/output/functions/_render.func/package.json with only {"type":"module"}.
// We need to add runtime dependencies so Vercel installs them on the serverless container:
//   - @vncsleal/prisml-core and @vncsleal/prisml-runtime are loaded via createRequire at runtime
//   - onnxruntime-node has native .node binaries that esbuild cannot bundle
// We also copy demo-artifacts so readFile paths in the bundled chunk resolve correctly.
//   The chunk lives at <func-root>/apps/website/.vercel/output/_functions/chunks/
//   so "../../demo-artifacts/" resolves to <func-root>/apps/website/.vercel/output/demo-artifacts/

import { cpSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Copy demo artifacts
cpSync(
  resolve(root, 'demo-artifacts'),
  resolve(root, '.vercel/output/demo-artifacts'),
  { recursive: true },
);

// Patch function package.json
writeFileSync(
  resolve(root, '.vercel/output/functions/_render.func/package.json'),
  JSON.stringify({
    type: 'module',
    dependencies: {
      '@vncsleal/prisml-core': '0.2.2',
      '@vncsleal/prisml-runtime': '0.2.3',
      'onnxruntime-node': '1.16.3',
    },
  }, null, 2),
);

console.log('✓ Vercel output patched: demo-artifacts copied, function deps declared');
