# PrisML

[![CI](https://github.com/vncsleal/prisml/actions/workflows/ci.yml/badge.svg)](https://github.com/vncsleal/prisml/actions/workflows/ci.yml)

Compiler-first machine learning library for TypeScript + Prisma applications.

## Overview

PrisML treats ML model training as a **compile-time step**, generating immutable ONNX artifacts that provide type-safe, in-process predictions at runtime.

**Philosophy:**
- Training = compilation (build-time)
- Artifacts = immutable binaries (committed to git)
- Predictions = synchronous function calls (in-process)

## Requirements

**Node.js**: 18 or higher

**Python 3.9+** is required for the `prisml train` command. The training backend uses the following packages (pinned in [`packages/cli/python/requirements.txt`](packages/cli/python/requirements.txt)):

```
numpy==1.26.4
scikit-learn==1.5.2
skl2onnx==1.16.0
onnx==1.16.0
```

Install them in your environment before running `prisml train`:

```bash
pip install -r node_modules/@vncsleal/prisml/python/requirements.txt
```

> **Note:** Python is a **build-time dependency only** — it is not required at runtime. Prediction via `PredictionSession` runs entirely in Node.js against the compiled ONNX artifact.

## Quick Start

### Installation

```bash
npm install @vncsleal/prisml
```

`@vncsleal/prisml` is the only package — it includes the runtime prediction engine, CLI, and Python training backend.

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
import { salesModel } from './prisml.config';

const session = new PredictionSession();
await session.load(salesModel);

const result = await session.predict(salesModel, product);
// { modelName: 'ProductSales', prediction: 42.3, timestamp: '...' }
```

## Features

✓ Type-safe model definitions  
✓ Prisma schema binding with drift detection  
✓ Schema-only contract validation (`prisml check`)  
✓ ONNX Runtime integration  
✓ Deterministic feature encoding  
✓ Quality gates for build-time validation  
✓ Typed error handling  

## Monorepo

| Path | Contents |
|---|---|
| [`packages/prisml`](packages/prisml) | `@vncsleal/prisml` — types, errors, CLI, runtime, Python backend |
| [`apps/website`](apps/website) | [getprisml.vercel.app](https://getprisml.vercel.app) — documentation site and live demo |
| [`examples/basic`](examples/basic) | End-to-end example project |
| [`docs/`](docs) | Architecture, API reference, guides |

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

# Run tests in watch mode
pnpm test:watch
```

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
