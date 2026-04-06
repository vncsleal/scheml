# @vncsleal/scheml

Compiler-first machine learning library for TypeScript applications.

## Overview

ScheML treats training as a build-time compilation step that emits immutable artifacts. Runtime code consumes those artifacts through an explicit adapter contract and fails loudly when the current schema no longer matches the compiled artifact.

Core principles:

- training is build-time compilation
- artifacts are immutable contract outputs
- runtime serving is explicit and in-process
- schema drift is a hard error, not a fallback condition
- adapter choice is explicit, not inferred

## Installation

```bash
npm install @vncsleal/scheml
```

For training:

```bash
pip install -r node_modules/@vncsleal/scheml/python/requirements.txt
```

## Quick Start

### 1. Define A Trait And Adapter

```typescript
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const productSales = defineTrait('Product', {
  type: 'predictive',
  name: 'productSales',
  target: 'sales',
  features: ['price', 'stock', 'category'],
  output: { field: 'predictedSales', taskType: 'regression' },
  qualityGates: [
    { metric: 'r2', threshold: 0.85, comparison: 'gte' },
  ],
});

export default defineConfig({
  adapter: 'prisma',
  schema: './prisma/schema.prisma',
  traits: [productSales],
});
```

### 2. Train

```bash
scheml train --config ./scheml.config.ts --schema ./prisma/schema.prisma --output ./.scheml
```

Outputs to `.scheml/`:

- `productSales.metadata.json`
- `productSales.onnx`

Different trait types may emit different runtime artifact files, but metadata is always the canonical contract.

### 3. Predict

Option A, explicit runtime session:

```typescript
import { PredictionSession } from '@vncsleal/scheml';

const session = new PredictionSession();

await session.loadTrait('productSales', {
  artifactsDir: '.scheml',
  schemaPath: './prisma/schema.prisma',
  adapter: 'prisma',
});

const result = await session.predict('productSales', product, {
  price: (p) => p.price,
  stock: (p) => p.stock,
  category: (p) => p.category,
});
```

Option B, client extension for interceptor-backed adapters:

```typescript
import { extendClient } from '@vncsleal/scheml';
import config from './scheml.config';

const client = await extendClient(prisma, config, {
  mode: 'materialized',
});
```

## Current Runtime Support

| Adapter | Schema Reader | Extractor | `extendClient()` | Notes |
|---|---|---|---|---|
| Prisma | yes | yes | yes | primary relational path |
| Drizzle | yes | optional | no | use `PredictionSession` directly |
| TypeORM | yes | yes | yes | runtime interception supported |
| Zod | yes | no | no | schema contract only |

## Trait Kinds

ScheML supports five trait kinds:

- predictive
- anomaly
- similarity
- temporal
- generative

Runtime entrypoints:

- predictive: `predict()`, `predictBatch()`
- anomaly: `predict()`, `predictBatch()`
- temporal: `predict()`, `predictBatch()`
- similarity: `predictSimilarity()`
- generative: metadata contract, not ONNX runtime serving

## Public API Highlights

### `defineTrait(entity, config)`

Declares a trait and returns a resolved trait with `record()` and `recordBatch()` helpers.

### `defineConfig(config)`

Declares the explicit adapter, schema source, and traits for a project.

### `extendClient(client, config, options?)`

Extends supported clients in either `materialized` or `live` mode.

`hybrid` mode is not supported.

### `PredictionSession`

Low-level runtime entrypoint for loading trait artifacts and running inference.

### Schema Hash Utilities

ScheML exposes adapter-neutral schema hashing utilities:

- `hashSchemaGraph()`
- `hashSchemaGraphEntity()`
- `hashSchemaEntity()`
- `hashSchemaSource()`
- `computeMetadataSchemaHash()`
- `compareSchemaHashes()`

Text-schema helpers also remain available:

- `normalizeSchemaText()`
- `hashSchemaText()`
- `hashSchemaEntitySubset()`

## Runtime Guarantees

- runtime schema validation is explicit and adapter-aware
- missing live trait artifacts fail loudly
- batch validation is atomic
- similarity traits use `predictSimilarity()`, not `predict()`
- runtime does not infer adapters from schema paths

## Quality Gates

```typescript
qualityGates: [
  { metric: 'r2', threshold: 0.85, comparison: 'gte' },
  { metric: 'rmse', threshold: 500, comparison: 'lte' },
]
```

`scheml train` exits non-zero if any gate fails.

## Feature Encoding

| Feature type | Runtime encoding behavior |
|---|---|
| `number` | numeric scaling or raw numeric contract |
| `boolean` | `0` or `1` |
| `string` | label, hash, or one-hot contract from metadata |
| `Date` | timestamp |
| `null` or `undefined` | imputation according to compiled contract |

## CLI

Main commands:

- `scheml train`
- `scheml check`
- `scheml status`
- `scheml inspect`
- `scheml diff`
- `scheml audit`
- `scheml migrate`
- `scheml init`

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
