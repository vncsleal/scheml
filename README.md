# PrisML

Compiler-first machine learning library for TypeScript + Prisma applications.

## Overview

PrisML treats ML model training as a **compile-time step**, generating immutable ONNX artifacts that provide type-safe, in-process predictions at runtime.

**Philosophy:**
- Training = compilation (build-time)
- Artifacts = immutable binaries (committed to git)
- Predictions = synchronous function calls (in-process)

## Quick Start

### Installation

```bash
npm install @vncsleal/prisml
```

### 1. Define Models

Create `prisml.config.ts`:

```typescript
import { defineModel } from '@vncsleal/prisml';

export const salesModel = defineModel<Product>({
  name: 'ProductSales',
  modelName: 'Product',
  output: { field: 'sales', taskType: 'regression' },
  features: {
    price: (p) => p.price,
    stock: (p) => p.stock,
  },
  algorithm: { name: 'forest', version: '1.0.0' },
});
```

### 2. Train Models

```bash
npx prisml train --config ./prisml.config.ts --schema ./prisma/schema.prisma
```

Generates immutable artifacts:
- `ProductSales.onnx` - Model binary
- `ProductSales.metadata.json` - Schema contract

### 3. Run Predictions

```typescript
import { PredictionSession } from '@vncsleal/prisml';

const session = new PredictionSession();
await session.initializeModel(
  './.prisml/ProductSales.metadata.json',
  './.prisml/ProductSales.onnx',
  schemaHash
);

const result = await session.predict('ProductSales', product, {
  price: (p) => p.price,
  stock: (p) => p.stock,
});
```

## Features

✓ Type-safe model definitions  
✓ Prisma schema binding with drift detection  
✓ Schema-only contract validation (`prisml check`)  
✓ ONNX Runtime integration  
✓ Deterministic feature encoding  
✓ Quality gates for build-time validation  
✓ Typed error handling  

## Packages

- **[@vncsleal/prisml](packages/prisml)** - Umbrella package (core + runtime + CLI)
- **[@vncsleal/prisml-core](packages/core)** - Model definitions and types
- **[@vncsleal/prisml-cli](packages/cli)** - Training and validation commands
- **[@vncsleal/prisml-runtime](packages/runtime)** - ONNX inference engine
- **[@vncsleal/prisml-generator](packages/generator)** - Prisma schema annotations generator

## Documentation

- [User Guide](docs/GUIDE.md) - Complete usage guide and examples
- [Feature Specification](docs/FEATURES.md) - Detailed feature documentation
- [Architecture](docs/ARCHITECTURE.md) - System design and implementation
- [Changelog](CHANGELOG.md) - Release history

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run tests
pnpm test
```

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
