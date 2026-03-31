import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

// Vercel injects VERCEL_URL at build time (e.g. "my-project-abc123.vercel.app").
const vercelUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://getscheml.vercel.app';

export default defineConfig({
  adapter: vercel({
    includeFiles: [
      // Demo model artifacts
      'demo-artifacts/schema.prisma',
      'demo-artifacts/userChurn.metadata.json',
      'demo-artifacts/userChurn.onnx',
      // onnxruntime-web WASM files — nft doesn't trace dynamically-resolved
      // binary assets, so they must be listed explicitly.
      'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
      'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
      'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
    ],
  }),
  site: vercelUrl,
  output: 'hybrid',
  vite: {
    ssr: {
      external: ['@vncsleal/scheml', 'onnxruntime-web'],
    },
  },
});
