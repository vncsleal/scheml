import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/index.ts', 'src/runtime/extension/client.ts'],
        format: ['cjs', 'esm'],
        dts: false,
        clean: true,
        outDir: 'dist',
        tsconfig: 'tsconfig.runtime.json',
        external: ['src/compiler', 'src/cli'] // Hard block
    },
    {
        entry: {
            cli: 'src/cli/index.ts'
        },
        format: ['cjs'],
        dts: false,
        outDir: 'dist',
        target: 'node16',
        tsconfig: 'tsconfig.compiler.json',
        // Bundle dependencies for the CLI to be self-contained
        noExternal: ['commander', 'chalk', 'ora', 'zod']
    }
]);
