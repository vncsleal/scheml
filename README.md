# PrisML

Compiler-first machine learning library for TypeScript + Prisma applications.

## Project Structure

```
packages/
  core/          # defineModel, types, schema hashing
  cli/           # prisml train command
  runtime/       # ONNX inference, error handling
  python/        # Python backend for training
examples/        # Integration examples
docs/            # Architecture guide, API reference
```

## MVP Scope

✓ Declare predictive models in TypeScript
✓ Compile to immutable ONNX artifacts + metadata at build time
✓ Execute predictions synchronously, in-process at runtime
✓ Schema hashing for safety
✓ Conservative feature extraction via AST analysis
✓ Typed error handling

## Getting Started

```bash
# Install
npm install

# Develop
npm run dev

# Build
npm run build

# Test
npm run test
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for deep dive.
