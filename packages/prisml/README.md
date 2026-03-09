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

Python training backend requires:

```bash
pip install -r node_modules/@vncsleal/prisml/python/requirements.txt
```

## Quick Start

### 1. Define your model (`prisml.config.ts`)

```typescript
import { defineModel } from '@vncsleal/prisml';

export const salesModel = defineModel<Product>({
  name: 'productSales',
  modelName: 'Product',
  output: { field: 'sales', taskType: 'regression' },
  features: {
    price: (p) => p.price,
    stock: (p) => p.stock,
  },
  algorithm: { name: 'forest', version: '1.0.0' },
});
```

### 2. Train (build-time)

```bash
npx prisml train --config ./prisml.config.ts --schema ./prisma/schema.prisma
```

Outputs to `.prisml/`:
- `productSales.onnx` — model binary
- `productSales.metadata.json` — schema contract

### 3. Predict (runtime)

```typescript
import { PredictionSession } from '@vncsleal/prisml';
import { salesModel } from './prisml.config';

const session = new PredictionSession();
await session.load(salesModel); // resolves .prisml/ and prisma/schema.prisma automatically

const result = await session.predict(salesModel, product);
// { modelName: 'productSales', prediction: 42.3, timestamp: '...' }
```

## API

### `defineModel<T>(definition)`

Declares a model. Pure config — no side effects.

### `new PredictionSession()`

#### `session.load(model, opts?)`

Loads a trained model from `.prisml/<name>.{onnx,metadata.json}` and hashes `prisma/schema.prisma` automatically.

- `opts.artifactsDir` — override artifacts directory (default: `.prisml/`)
- `opts.schemaPath` — override schema path (default: `prisma/schema.prisma`)

#### `session.predict(model, entity)`

Runs inference on a single entity using the resolvers declared in `model.features`.

#### `session.predictBatch(model, entities)`

Runs inference over an array of entities. Preflight is atomic — any validation failure aborts the entire batch with no partial execution.

#### `session.initializeModel(metadataPath, onnxPath, schemaHash)`

Low-level path-based initializer. Prefer `session.load()`.

### `hashPrismaSchema(schema: string): string`

Returns the normalized SHA-256 hash of a Prisma schema string. Used for drift detection.

## Quality Gates

```typescript
qualityGates: [
  { metric: 'r2', threshold: 0.85, comparison: 'gte' },
  { metric: 'rmse', threshold: 500, comparison: 'lte' },
]
```

`prisml train` exits non-zero if any gate fails.

## Supported Algorithms

| Name | Regression | Classification |
|------|-----------|----------------|
| `linear` | LinearRegression | LogisticRegression |
| `tree` | DecisionTreeRegressor | DecisionTreeClassifier |
| `forest` | RandomForestRegressor | RandomForestClassifier |
| `gbm` | GradientBoostingRegressor | GradientBoostingClassifier |

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
