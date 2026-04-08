import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // onnxruntime-node uses a native .node binary that can't be loaded in
    // multiple worker_threads simultaneously — forks avoids that constraint.
    pool: 'forks',
  },
});
