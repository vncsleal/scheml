import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
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
const demoBundleFiles = listFilesRecursive(join(projectRoot, 'demo-bundle'))
  .map((p) => './' + p.slice(projectRoot.length).replace(/\\/g, '/'));

// Vercel injects VERCEL_URL at build time (e.g. "my-project-abc123.vercel.app").
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://scheml.vercel.app';

export default defineConfig({
  adapter: vercel({
    includeFiles: demoBundleFiles,
  }),
  site: vercelUrl,
  output: 'hybrid',
});
