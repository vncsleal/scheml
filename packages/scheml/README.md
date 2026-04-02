# @vncsleal/scheml

Compiler-first machine learning library for TypeScript + Prisma applications.

## Overview

ScheML treats ML model training as a **compile-time step**, generating immutable ONNX artifacts that provide type-safe, in-process predictions at runtime.

**Philosophy:**
- Training = compilation (build-time)
- Artifacts = immutable binaries (committed to git)
- Predictions = synchronous function calls (in-process)

## Installation

```bash
npm install @vncsleal/scheml
```

Python training backend requires:

```bash
pip install -r node_modules/@vncsleal/scheml/python/requirements.txt
```

## Quick Start

### 1. Define your trait (`scheml.config.ts`)

```typescript
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const productSales = defineTrait('Product', {
  type: 'predictive',
  name: 'productSales',
  target: 'sales',
  features: ['price', 'stock', 'category'],
  output: { field: 'predictedSales', taskType: 'regression' },
  // algorithm is optional — omit it and FLAML AutoML selects the best estimator
  qualityGates: [
    { metric: 'r2', threshold: 0.85, comparison: 'gte' },
  ],
});

export default defineConfig({
  adapter: 'prisma',
  traits: [productSales],
});
```

### 2. Train (build-time)

```bash
npx scheml train --config ./scheml.config.ts --schema ./prisma/schema.prisma
```

Outputs to `.scheml/`:
- `productSales.onnx` — model binary
- `productSales.metadata.json` — schema contract

### 3. Predict (runtime)

**Option A — Prisma extension (recommended):**

```typescript
import { extendClient } from '@vncsleal/scheml';
import { prisma } from './lib/prisma';
import config from './scheml.config';

const client = await extendClient(prisma, config);

const product = await client.product.findFirst({ where: { id } });
console.log(product.predictedSales); // live or materialized prediction
```

**Option B — direct ONNX session:**

```typescript
import { PredictionSession } from '@vncsleal/scheml';

const session = new PredictionSession();
await session.initializeModel(
  '.scheml/productSales.metadata.json',
  '.scheml/productSales.onnx',
  schemaHash
);

const result = await session.predict('productSales', product, {
  price: (p) => p.price,
  stock: (p) => p.stock,
  category: (p) => p.category,
});
// { modelName: 'productSales', prediction: 42.3, timestamp: '...' }
```

## API

### `defineTrait(entity, config)`

Declares an intelligence trait on an entity type. Returns a `ResolvedTrait` with
the full config plus `record()` / `recordBatch()` feedback methods.

```typescript
import { defineTrait } from '@vncsleal/scheml';

const churnRisk = defineTrait('User', {
  type: 'predictive',
  name: 'churnRisk',
  target: 'churned',
  features: ['loginCount', 'plan', 'totalSpend'],
  output: { field: 'churnScore', taskType: 'binary_classification' },
  qualityGates: [{ metric: 'f1', threshold: 0.85, comparison: 'gte' }],
});

// Record ground-truth observations for accuracy decay tracking
await churnRisk.record(userId, { actual: true, predicted: 0.9 });
```

Supported trait types: `'predictive'` | `'anomaly'` | `'similarity'` | `'sequential'` | `'generative'`

### `defineConfig(config)`

Typed configuration factory for `scheml.config.ts`.

```typescript
import { defineConfig } from '@vncsleal/scheml';

export default defineConfig({
  adapter: 'prisma',       // 'prisma' | 'drizzle' | 'zod' | custom
  traits: [churnRisk],
});
```

### `extendClient(prisma, config, opts?)`

Extends a Prisma client with trait fields. Returns the extended client.

```typescript
import { extendClient } from '@vncsleal/scheml';

const client = await extendClient(prisma, config, {
  mode: 'hybrid',         // 'materialized' | 'live' | 'hybrid' (default: 'materialized')
  cacheTtlMs: 30_000,
});
```

### `new PredictionSession()`

Low-level ONNX inference session.

#### `session.initializeModel(metadataPath, onnxPath, schemaHash)`

Path-based model initializer.

#### `session.predict(traitName, entity, resolvers)`

Runs inference on a single entity.

#### `session.predictBatch(traitName, entities, resolvers)`

Runs inference over an array of entities. Preflight validation is atomic — any
failure aborts the entire batch with no partial execution.

### `hashPrismaSchema(schema: string): string`

Returns the normalized SHA-256 hash of a full Prisma schema string. Used for drift detection.

### `hashPrismaModelSubset(schema: string, modelName: string): string`

Returns a SHA-256 hash scoped to a single model block and its referenced enums. Changes to unrelated models do not invalidate artifacts compiled with this hash (default for artifacts compiled with `metadataSchemaVersion >= 1.2.0`).

## Quality Gates

```typescript
qualityGates: [
  { metric: 'r2', threshold: 0.85, comparison: 'gte' },
  { metric: 'rmse', threshold: 500, comparison: 'lte' },
]
```

`scheml train` exits non-zero if any gate fails.

## Supported Algorithms

| Name | Regression | Classification |
|------|-----------|----------------|
| *(omit)* | **AutoML (FLAML, default)** — selects best estimator in 60s | same |
| `linear` | LinearRegression | LogisticRegression |
| `tree` | DecisionTreeRegressor | DecisionTreeClassifier |
| `forest` | RandomForestRegressor | RandomForestClassifier |
| `gbm` | GradientBoostingRegressor | GradientBoostingClassifier |

## Feature Encoding

| Feature type | Encoding |
|---|---|
| `number` | Standard scaling (mean/std computed at train time) |
| `boolean` | 0 / 1 |
| `string` | One-hot encoding (categories computed at train time) |
| `Date` | Unix timestamp (ms) |
| `null` / `undefined` | Imputation |

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
