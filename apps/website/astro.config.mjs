import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';
import { cpSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

// Vercel injects VERCEL_URL at build time (e.g. "my-project-abc123.vercel.app").
// Fall back to prisml.dev once a custom domain is set.
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://prisml.dev';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Vite plugin that copies demo-artifacts into the serverless function bundle.
// The bundled demoPrediction chunk resolves relative URLs from its own location,
// which is <func-root>/apps/website/.vercel/output/_functions/chunks/.
// "../../demo-artifacts/" from there = <func-root>/apps/website/.vercel/output/demo-artifacts/
const copyDemoArtifacts = {
  name: 'copy-demo-artifacts',
  closeBundle() {
    const src = resolve(__dirname, 'demo-artifacts');
    const dest = resolve(__dirname, '.vercel/output/demo-artifacts');
    cpSync(src, dest, { recursive: true });
  },
};

export default defineConfig({
  adapter: vercel(),
  site: vercelUrl,
  output: 'hybrid',
  vite: {
    plugins: [copyDemoArtifacts],
  },
});
