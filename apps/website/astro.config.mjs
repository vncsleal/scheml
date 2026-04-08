import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

// Vercel injects VERCEL_URL at build time (e.g. "my-project-abc123.vercel.app").
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://getscheml.vercel.app';

export default defineConfig({
  adapter: vercel({
    includeFiles: ['./demo-bundle'],
  }),
  site: vercelUrl,
  output: 'hybrid',
});
