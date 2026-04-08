import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

function listFilesRecursive(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFilesRecursive(full));
    else results.push(full);
  }
  return results;
}

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
// Two levels up from apps/website → workspace root
const workspaceRoot = join(projectRoot, '../..');

const demoBundleFiles = listFilesRecursive(join(projectRoot, 'demo-bundle'))
  .map((p) => './' + p.slice(projectRoot.length).replace(/\\/g, '/'));

// Exclude non-linux/x64 onnxruntime-node binaries to stay under Vercel's 250MB
// Lambda limit. Vercel runs on linux/x64; darwin and win32 binaries are dead
// weight (~177 MB combined on onnxruntime-node@1.24.3).
function findOnnxNapiBinDir(wsRoot) {
  const pnpmStore = join(wsRoot, 'node_modules/.pnpm');
  if (!existsSync(pnpmStore)) return null;
  for (const entry of readdirSync(pnpmStore)) {
    if (!entry.startsWith('onnxruntime-node@')) continue;
    const napiBin = join(pnpmStore, entry, 'node_modules/onnxruntime-node/bin/napi-v6');
    if (existsSync(napiBin)) return napiBin;
  }
  return null;
}

const napiBinDir = findOnnxNapiBinDir(workspaceRoot);
const excludeOnnxFiles = [];
if (napiBinDir) {
  for (const platform of readdirSync(napiBinDir, { withFileTypes: true })) {
    if (!platform.isDirectory()) continue;
    const platformDir = join(napiBinDir, platform.name);
    if (platform.name === 'linux') {
      // Keep linux/x64 only — exclude all other arches (e.g. arm64)
      for (const arch of readdirSync(platformDir, { withFileTypes: true })) {
        if (!arch.isDirectory() || arch.name === 'x64') continue;
        for (const f of listFilesRecursive(join(platformDir, arch.name))) {
          excludeOnnxFiles.push(relative(projectRoot, f).replace(/\\/g, '/'));
        }
      }
    } else {
      // Exclude darwin, win32, and any other non-linux platforms entirely
      for (const f of listFilesRecursive(platformDir)) {
        excludeOnnxFiles.push(relative(projectRoot, f).replace(/\\/g, '/'));
      }
    }
  }
}

// Vercel injects VERCEL_URL at build time (e.g. "my-project-abc123.vercel.app").
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://scheml.vercel.app';

export default defineConfig({
  adapter: vercel({
    includeFiles: demoBundleFiles,
    excludeFiles: excludeOnnxFiles,
  }),
  site: vercelUrl,
  output: 'hybrid',
  vite: {
    ssr: {
      // Must be external so Vite emits a real import() that @vercel/nft can
      // trace — createRequire() calls are invisible to nft and the package
      // (plus its onnxruntime-node native binary) never makes it into the bundle.
      external: ['@vncsleal/scheml'],
    },
  },
});
