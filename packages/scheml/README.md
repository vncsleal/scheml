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
import { createPredictionSession } from '@vncsleal/scheml';
import config from './scheml.config';

const session = createPredictionSession(config);

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

Materialized column contract:

- persisted trait columns are keyed by `trait.name`
- `output.field` describes trait output metadata and artifact shape
- `scheml migrate`, `scheml materialize`, and `extendClient(..., { mode: 'materialized' })` all use the trait name as the database column
- `scheml materialize` always disposes its prediction session and disconnects the adapter extractor before exit, including failure paths

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
- generative: `predictGenerative()` using `defineConfig({ generativeProvider })` as the default provider, with an optional per-call override

Generative runtime contract:

- `defineConfig({ generativeProvider })` is the project-level default provider for generative traits
- `scheml train` fails fast for generative traits when no provider is configured
- `createPredictionSession(config)` binds that configured provider into runtime sessions
- `session.predictGenerative(trait, entity, overrideProvider?)` still supports explicit provider overrides when needed

## Public API Highlights

### `defineTrait(entity, config)`

Declares a trait and returns a resolved trait with `record()` and `recordBatch()` helpers.

Trait composition uses object references via `traits: [...]`. At config load time, ScheML validates the full trait graph with `resolveTraitGraph()` semantics and rejects missing references, duplicate names, and dependency cycles before training starts. When dependencies are present, ScheML trains in topological order so prerequisite traits run before dependents.

Trait names are part of the on-disk contract for artifacts, history, and feedback. Use only letters, digits, underscores, and hyphens.

### `defineConfig(config)`

Declares the explicit adapter, schema source, and traits for a project.

### `extendClient(client, config, options?)`

Extends supported clients in either `materialized` or `live` mode.

In `materialized` mode, ScheML reads persisted values from the column named after the trait itself. For predictive traits, this means `trait.name` is the database column contract; `output.field` does not rename the materialized column.

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

Current enforcement scope:

- predictive and temporal traits enforce quality gates against reported test metrics during `scheml train`
- anomaly, similarity, and generative traits do not yet emit evaluable training metrics for gate enforcement
- if those trait types declare `qualityGates`, `scheml train` now fails fast with a configuration error instead of silently ignoring the gates

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

Training order and `--trait` behavior:

- ScheML validates the configured trait dependency graph before training begins
- training runs in dependency order, not raw array order from `config.traits`
- `scheml train --trait <name>` includes that trait's dependencies automatically and trains the resulting dependency closure in topological order

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
