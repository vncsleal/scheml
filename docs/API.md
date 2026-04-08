# ScheML API Reference

## Package

`@vncsleal/scheml` is the single runtime and build-time package. It contains:

- the trait definition API
- adapter abstractions and built-in adapters
- schema hashing and contract validation utilities
- runtime inference via `PredictionSession`
- CLI commands such as `train`, `check`, `inspect`, `status`, `diff`, `audit`, `migrate`, and `init`
- the Python training backend used by `scheml train`

```bash
npm install @vncsleal/scheml
```

## Core Types

### `QualityGate`

```typescript
interface QualityGate {
  metric: 'mse' | 'rmse' | 'mae' | 'r2' | 'accuracy' | 'precision' | 'recall' | 'f1';
  threshold: number;
  comparison: 'gte' | 'lte';
  description?: string;
}
```

### `ImputationRule`

```typescript
interface ImputationRule {
  strategy: 'mean' | 'median' | 'mode' | 'constant';
  value?: number | string | boolean;
}
```

### `CategoryEncoding`

```typescript
interface CategoryEncoding {
  type: 'label' | 'hash' | 'onehot';
  mapping?: Record<string, number>;
  categories?: string[];
}
```

### `PredictionOutput`

```typescript
interface PredictionOutput {
  modelName: string;
  prediction: number | string;
  confidence?: number;
  timestamp: string;
}
```

### `SimilarityPredictionOutput`

```typescript
interface SimilarityPredictionOutput {
  traitName: string;
  matches: Array<{
    entityId: unknown;
    score: number;
    rank: number;
  }>;
  timestamp: string;
}
```

### Artifact Metadata

ScheML emits trait-specific artifact metadata rather than one Prisma-only metadata shape. Common fields include:

```typescript
interface ArtifactMetadataBase {
  version: string;
  metadataSchemaVersion: string;
  traitType: 'predictive' | 'anomaly' | 'similarity' | 'temporal' | 'generative';
  traitName: string;
  schemaHash: string;
  compiledAt: string;
  entityName?: string;
}
```

Predictive and temporal ONNX artifacts include feature contract data such as `features`, `encoding`, `imputation`, `scaling`, `tensorSpec`, and `output`.

Anomaly artifacts include baseline feature names and normalization statistics.

Similarity artifacts include the embedding index format and index paths.

Generative artifacts include prompt shape metadata rather than ONNX files.

## Definition API

### `defineTrait(entity, config)`

Declares a trait and returns a resolved trait object with feedback helpers. The entity can be:

- a string entity name for string-name adapters such as Prisma and TypeORM
- a runtime object such as a Drizzle table or a Zod schema object for runtime-object adapters

```typescript
import { defineTrait } from '@vncsleal/scheml';

const churnRisk = defineTrait('User', {
  type: 'predictive',
  name: 'churnRisk',
  target: 'churned',
  features: ['plan', 'totalSpend', 'daysSinceLogin'],
  output: {
    field: 'churnScore',
    taskType: 'binary_classification',
  },
  qualityGates: [
    {
      metric: 'f1',
      threshold: 0.85,
      comparison: 'gte',
    },
  ],
});

await churnRisk.record('user_123', { actual: true, predicted: 0.92 });
await churnRisk.recordBatch([
  { id: 'user_123', actual: true, predicted: 0.92 },
  { id: 'user_456', actual: false, predicted: 0.13 },
]);
```

Supported trait kinds:

- `predictive`
- `anomaly`
- `similarity`
- `temporal`
- `generative`

Trait graph behavior:

- trait composition uses object references via `traits: [...]`, not string names
- config loading validates the full trait graph before command execution
- duplicate trait names, missing referenced traits, and dependency cycles are treated as configuration errors
- commands that operate on configured traits consume them in topological dependency order

Trait names are also used as stable file-backed identifiers for artifacts, history, and feedback. Keep them limited to letters, digits, underscores, and hyphens.

### `defineConfig(config)`

Typed factory for `scheml.config.ts`.

```typescript
import { defineConfig } from '@vncsleal/scheml';
import { openai } from '@ai-sdk/openai';

export default defineConfig({
  adapter: 'prisma',
  schema: './prisma/schema.prisma',
  generativeProvider: openai('gpt-4.1-mini'),
  traits: [churnRisk],
});
```

`adapter` is required. It can be a built-in adapter name or a configured adapter instance.

`generativeProvider` behavior:

- acts as the project-level default provider for generative traits
- is validated during `scheml train` when a generative trait is present
- is applied to runtime sessions created with `createPredictionSession(config)`
- can still be overridden per call with `session.predictGenerative(trait, entity, provider)`

## Adapter API

Built-in factories:

```typescript
import { createPrismaAdapter, createZodAdapter, createTypeOrmAdapter } from '@vncsleal/scheml';

// Drizzle adapter is an optional subpath (requires drizzle-orm peer dep)
import { createDrizzleAdapter } from '@vncsleal/scheml/adapters/drizzle';
```

Registry helpers:

```typescript
import { getAdapter, registerAdapter, listAdapters } from '@vncsleal/scheml';
```

`inferAdapterFromSchema` is no longer part of the public API. Adapter selection is explicit.

## Schema Contract API

ScheML now uses adapter-neutral schema hashing. Runtime and build-time code compare the current adapter-normalized entity shape against the artifact's stored `schemaHash`.

### `hashSchemaGraph(graph)`

Hashes the full normalized schema graph.

### `hashSchemaGraphEntity(graph, entityName)`

Hashes a single normalized entity from a schema graph.

### `hashSchemaEntity(graph, entityName, reader?)`

Returns the primary entity-scoped hash. When a `reader` is provided, the adapter's own `hashModel()` implementation is used.

### `hashSchemaSource(source, reader, entityName?)`

Reads a schema source through an adapter reader and returns either a graph hash or an entity hash.

### `computeMetadataSchemaHash(graph, metadata, reader)`

Computes the current runtime hash for an artifact metadata object.

### `resolveSchemaEntityName(metadata)`

Resolves the entity name used for hashing from metadata.

### `compareSchemaHashes(expected, actual)`

Returns:

```typescript
{
  valid: boolean;
  expectedHash: string;
  actualHash: string;
}
```

### Text Schema Helpers

These remain useful for text-schema workflows and tests:

```typescript
import {
  normalizeSchemaText,
  hashSchemaText,
  hashSchemaEntitySubset,
  validateSchemaHash,
  extractModelNames,
  parseModelSchema,
} from '@vncsleal/scheml';
```

`hashSchemaEntitySubset()` is the entity-scoped text-schema helper that replaced the old Prisma-specific subset hash surface.

## Analysis And Encoding API

### `analyzeFeatureResolver(sourceCode, functionName?)`

Inspects a resolver for static extractability and returns access-path analysis.

### `validateHydration(accessPaths, entity, allowNull?)`

Checks whether an entity shape satisfies the access paths expected by a feature resolver.

### `normalizeFeatureVector(features, schema, encodings, imputations)`

Compiles feature values into the numeric vector expected by the trained artifact.

### `buildCategoryMapping(values)` and `buildCategories(values)`

Helpers for deterministic categorical contract construction.

## Runtime API

### `new PredictionSession()`

Creates a reusable runtime inference session.

For config-backed generative traits, prefer:

```typescript
import { createPredictionSession } from '@vncsleal/scheml';
import config from './scheml.config';

const session = createPredictionSession(config);
const output = await session.predictGenerative(productPitch, product);
```

### `session.loadTrait(traitName, options)`

Loads a trait artifact from disk and validates it against the current schema using an explicit adapter.

```typescript
import { PredictionSession } from '@vncsleal/scheml';

const session = new PredictionSession();

await session.loadTrait('productSales', {
  artifactsDir: '.scheml',
  schemaPath: './prisma/schema.prisma',
  adapter: 'prisma',
});
```

Rules:

- `adapter` is required
- `schemaPath` is required for schema-backed runtime validation
- predictive and temporal traits load ONNX sessions
- anomaly traits load metadata-backed runtime scoring state
- similarity traits load the similarity index and use `predictSimilarity()`
- generative traits use `predictGenerative()` and the configured default provider

### `session.initializeModel(metadataPath, onnxPath, schemaHash)`

Low-level initializer for ONNX-backed predictive and temporal artifacts.

### `session.predict(traitName, entity, resolvers)`

Runs a single prediction.

- predictive traits return the trained prediction
- temporal traits return the trained sequence-window prediction
- anomaly traits return a numeric anomaly score

Similarity traits do not use this method.

### `session.predictBatch(traitName, entities, resolvers)`

Runs batch inference with atomic validation.

### `session.predictSimilarity(traitName, entity, resolvers, options?)`

Runs nearest-neighbour retrieval for similarity traits.

```typescript
const result = await session.predictSimilarity('productSimilarity', product, {
  price: (row) => row.price,
  rating: (row) => row.rating,
}, { limit: 5 });
```

### `session.dispose(traitName)` and `session.disposeAll()`

Clears loaded runtime state.

## Client Extension API

### `extendClient(client, config, options?)`

Extends an adapter client with trait fields when the adapter implements a query interceptor.

```typescript
import { extendClient } from '@vncsleal/scheml';

const extended = await extendClient(prisma, config, {
  mode: 'materialized',
  cacheTtlMs: 30_000,
  materializedColumnsPresent: true,
});
```

Materialized column contract:

- persisted trait values are stored in the database column named after `trait.name`
- this contract is shared by `scheml migrate`, `scheml materialize`, and `extendClient(..., { mode: 'materialized' })`
- for predictive traits, `output.field` remains artifact/output metadata and does not rename the persisted column

Supported runtime modes:

- `materialized`
- `live`

`hybrid` is no longer supported.

In live mode, ScheML now fails loudly if any live-capable trait is missing its required artifact metadata.

## CLI

### `scheml train`

Runs the compile-time pipeline.

```bash
scheml train --config ./scheml.config.ts --schema ./prisma/schema.prisma --output ./.scheml
```

Responsibilities:

- load config and traits
- validate the trait dependency graph
- order traits topologically before execution
- resolve the explicit adapter
- read and hash the schema
- extract training data
- fit the feature contract
- invoke the Python backend
- evaluate quality gates
- emit immutable artifacts

`scheml train --trait <name>` selects the requested trait together with its dependencies and trains that dependency closure in topological order.

Quality gate enforcement currently applies to trait types whose training backends emit evaluation metrics during training. Today that means predictive and temporal traits. If anomaly, similarity, or generative traits declare `qualityGates`, `scheml train` fails fast with a configuration error rather than treating those gates as passive metadata.

### `scheml check`

Validates current schema compatibility against existing artifacts without retraining.

Use `--trait <name>` to validate a single trait artifact.

```bash
scheml check --config ./scheml.config.ts --schema ./prisma/schema.prisma --output ./.scheml
scheml check --trait churnRisk --json
```

### `scheml materialize`

Runs batch inference for one materializable trait and writes predictions back to the database column named after `trait.name`.

```bash
scheml materialize --trait churnRisk --config ./scheml.config.ts --schema ./prisma/schema.prisma --output ./.scheml
scheml materialize --trait churnRisk --json
```

Current support:

- predictive traits
- anomaly traits

Operational guarantees:

- loads the trained artifact before extraction so schema drift fails before writes begin
- writes predictions in batches using the requested `--batch-size`
- appends a `materialized` history record only after successful writes complete
- always disposes the in-memory prediction session and disconnects the adapter extractor in a `finally` path, whether materialization succeeds or throws

### Other Commands

- `scheml status` lists discovered artifacts and summaries
- `scheml inspect <trait>` prints metadata and history for one trait
- `scheml diff <trait>` compares the latest history states for one trait
- `scheml audit` summarizes artifact history state
- `scheml migrate` writes schema migrations for materialized trait columns on migration-capable adapters
- `scheml init` scaffolds a starter config and `.scheml/` directory

For materialized traits, the generated database column is always the trait name. Example: a predictive trait named `churnRisk` materializes into a `churnRisk` column even if `output.field` is `predictedChurnRisk`.

## Errors

All public failures use `ScheMLError` subclasses with structured context when applicable.

Common categories include:

- `SchemaDriftError`
- `ModelDefinitionError`
- `FeatureExtractionError`
- `HydrationError`
- `UnseenCategoryError`
- `ArtifactError`
- `QualityGateError`
- `ONNXRuntimeError`
- `EncodingError`
- `ConfigurationError`
  isPremium: (u) => u.plan === 'premium',
});
```

**Returns:**
```typescript
{
  modelName: string;
  prediction: number | string;
  confidence?: number;
  timestamp: string;
}
```

**Throws:**
- `ArtifactError` — if the trait artifact is not initialized
- `FeatureExtractionError` — if resolver fails
- `HydrationError` — if required fields missing
- `UnseenCategoryError` — if categorical value unseen
- `ONNXRuntimeError` — if ONNX execution fails

#### `session.predictBatch<T>(model, entities): Promise<BatchPredictionResult>`

Run predictions on multiple entities atomically using resolvers from `model.features`.

```typescript
const result = await session.predictBatch(userLTVModel, [user1, user2, user3]);
console.log(result.successCount);
```

**Behavior:**
- **Atomic execution:** Preflight validation runs on ALL entities before any ONNX inference
- **All-or-nothing:** If ANY entity fails validation, the entire batch throws with no partial execution
- **Blocking:** Large batches are intentionally blocking (caller must chunk)
- **No partial results:** Either all entities succeed, or the batch throws an error

**Returns:**
```typescript
{
  modelName: string;
  results: PredictionOutput[]; // Only successful predictions
  successCount: number;
  failureCount: number; // Always 0 (batch throws on any failure)
}
```

#### `session.dispose(modelName): Promise<void>`

Release the ONNX session for a loaded trait artifact.

```typescript
await session.dispose('userLTV');
```

