import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // onnxruntime-node uses a native .node binary that cannot be loaded
    // safely across multiple worker_threads on Node 18.
    pool: 'forks',
  },
});
