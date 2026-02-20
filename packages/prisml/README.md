# @vncsleal/prisml

Compiler-first machine learning library for TypeScript + Prisma applications.

## Overview

PrisML treats ML model training as a **compile-time step**, generating immutable ONNX artifacts that provide type-safe, in-process predictions at runtime.

**Philosophy:**
- Training = compilation (build-time)
- Artifacts = immutable binaries (committed to git)
- Predictions = synchronous function calls (in-process)

## Installation

```bash
npm install @vncsleal/prisml
```

This umbrella package includes:
- `@vncsleal/prisml-core` - Model definitions and types
- `@vncsleal/prisml-cli` - Training and validation commands
- `@vncsleal/prisml-runtime` - ONNX inference engine

## Quick Start

### 1. Define Model

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

### 2. Train (Build-Time)

```bash
npx prisml train --config ./prisml.config.ts --schema ./prisma/schema.prisma
```

Generates:
- `ProductSales.onnx` - Model binary
- `ProductSales.metadata.json` - Schema contract

### 3. Predict (Runtime)

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

## Additional Tools

### Schema Annotations

Install `@vncsleal/prisml-generator` to add type-safe ML annotations to your Prisma schema:

```bash
npm install @vncsleal/prisml-generator --save-dev
```

See [generator documentation](../generator/README.md) for details.

## Documentation

- [User Guide](../../docs/GUIDE.md)
- [Feature Specification](../../docs/FEATURES.md)
- [Architecture](../../docs/ARCHITECTURE.md)

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
