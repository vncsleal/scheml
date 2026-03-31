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

### 1. Define your model (`scheml.config.ts`)

```typescript
import { defineModel } from '@vncsleal/scheml';

export const salesModel = defineModel<Product>({
  name: 'productSales',
  modelName: 'Product',
  output: { field: 'sales', taskType: 'regression' },
  features: {
    price: (p) => p.price,
    stock: (p) => p.stock,
    category: (p) => p.category, // string → one-hot encoded automatically
  },
  // algorithm is optional — omit it and FLAML AutoML selects the best estimator
  qualityGates: [
    { metric: 'r2', threshold: 0.85, comparison: 'gte' },
  ],
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

```typescript
import { PredictionSession } from '@vncsleal/scheml';
import { salesModel } from './scheml.config';

const session = new PredictionSession();
await session.load(salesModel); // resolves .scheml/ and prisma/schema.prisma automatically

const result = await session.predict(salesModel, product);
// { modelName: 'productSales', prediction: 42.3, timestamp: '...' }
```

## API

### `defineModel<T>(definition)`

Declares a model. Pure config — no side effects.

### `new PredictionSession()`

#### `session.load(model, opts?)`

Loads a trained model from `.scheml/<name>.{onnx,metadata.json}` and hashes `prisma/schema.prisma` automatically.

- `opts.artifactsDir` — override artifacts directory (default: `.scheml/`)
- `opts.schemaPath` — override schema path (default: `prisma/schema.prisma`)

#### `session.predict(model, entity)`

Runs inference on a single entity using the resolvers declared in `model.features`.

#### `session.predictBatch(model, entities)`

Runs inference over an array of entities. Preflight is atomic — any validation failure aborts the entire batch with no partial execution.

#### `session.initializeModel(metadataPath, onnxPath, schemaHash)`

Low-level path-based initializer. Prefer `session.load()`.

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
