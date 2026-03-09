import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

// Vercel injects VERCEL_URL at build time (e.g. "my-project-abc123.vercel.app").
// Fall back to prisml.dev once a custom domain is set.
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://prisml.dev';

export default defineConfig({
  adapter: vercel(),
  site: vercelUrl,
  output: 'hybrid',
});
