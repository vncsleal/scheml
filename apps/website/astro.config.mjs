import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

// Vercel injects VERCEL_URL at build time (e.g. "my-project-abc123.vercel.app").
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://getprisml.vercel.app';

export default defineConfig({
  adapter: vercel({
    // Include demo model artifacts in the serverless function bundle.
    // They land at the project root inside the function, resolved via process.cwd().
    includeFiles: [
      'demo-artifacts/schema.prisma',
      'demo-artifacts/userChurn.metadata.json',
      'demo-artifacts/userChurn.onnx',
    ],
  }),
  site: vercelUrl,
  output: 'hybrid',
  vite: {
    ssr: {
      // Keep @vncsleal/prisml (and its onnxruntime-web dependency) as
      // runtime externals so WASM assets are not inlined into the bundle.
      // nft will trace them into the function's node_modules automatically.
      external: ['@vncsleal/prisml', 'onnxruntime-web'],
    },
  },
});
