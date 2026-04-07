# ScheML User Guide

## Prerequisites

### Node.js

Node.js 18 or higher is required.

### Python

`scheml train` uses the bundled Python backend to produce ONNX models and other trait artifacts. Python is required for training, not for normal predictive runtime use.

| Requirement | Version |
|---|---|
| Python | >= 3.9 |
| numpy | 1.26.4 |
| scikit-learn | 1.5.2 |
| skl2onnx | 1.16.0 |
| onnx | 1.16.0 |

Install the Python dependencies once before your first training run:

```bash
pip install -r node_modules/@vncsleal/scheml/python/requirements.txt
```

This installs the bundled training backend requirements used by `scheml train`.

### 4. Run Predictions

Use `PredictionSession` directly:

```typescript
import { createPredictionSession } from '@vncsleal/scheml';
import config from './scheml.config';

const session = createPredictionSession(config);

await session.loadTrait('userLTV', {
  artifactsDir: '.scheml',
  schemaPath: './prisma/schema.prisma',
  adapter: 'prisma',
});

const result = await session.predict('userLTV', user, {
  createdAt: (u) => u.createdAt,
  signupSource: (u) => u.signupSource,
  plan: (u) => u.plan,
});

console.log(result.prediction);
```

## Choosing A Runtime Surface

### `PredictionSession`

Use this when you want explicit runtime control or you are on an adapter without a query interceptor.

Current runtime coverage:

- predictive via `predict()` and `predictBatch()`
- temporal via `predict()` and `predictBatch()`
- anomaly via `predict()` and `predictBatch()`
- similarity via `predictSimilarity()`
- generative via `predictGenerative()` using the configured `generativeProvider` by default

For generative traits, define the provider once in config:

```typescript
import { openai } from '@ai-sdk/openai';
import { defineConfig } from '@vncsleal/scheml';

export default defineConfig({
  adapter: 'prisma',
  schema: './prisma/schema.prisma',
  generativeProvider: openai('gpt-4.1-mini'),
  traits: [retentionMessage],
});
```

Then call runtime generation without re-supplying the provider every time:

```typescript
const message = await session.predictGenerative(retentionMessage, user);
```

### `extendClient()`

Use this when you want traits exposed as fields on your ORM client.

Current interceptor-backed adapters:

- Prisma
- TypeORM

Current modes:

- `materialized`
- `live`

Live mode now fails loudly if a live-capable trait is missing its metadata artifact.

Materialized mode reads from database columns named after the trait. For example, a predictive trait with `name: 'churnRisk'` materializes into and reads from a `churnRisk` column. `output.field` still describes trait output metadata, but it is not used as the persisted column name.

## Adapter Examples

### Prisma

```typescript
export default defineConfig({
  adapter: 'prisma',
  schema: './prisma/schema.prisma',
  traits: [userLTV],
});
```

### Drizzle

```typescript
import { users } from './db/schema';

const churnRisk = defineTrait(users, {
  type: 'predictive',
  name: 'churnRisk',
  target: 'churned',
  features: ['signupDays', 'planTier'],
  output: { field: 'churnScore', taskType: 'binary_classification' },
});

In this example, the materialized database column remains `churnRisk`, not `churnScore`.

export default defineConfig({
  adapter: 'drizzle',
  schema: './src/db/schema.ts',
  traits: [churnRisk],
});
```

### TypeORM

```typescript
const accountHealth = defineTrait('Account', {
  type: 'predictive',
  name: 'accountHealth',
  target: 'healthScore',
  features: ['seatCount', 'lastInvoiceDays'],
  output: { field: 'healthScore', taskType: 'regression' },
});

export default defineConfig({
  adapter: 'typeorm',
  schema: './src/data-source.ts',
  traits: [accountHealth],
});
```

### Zod

```typescript
export default defineConfig({
  adapter: 'zod',
  schema: './src/schema.ts',
  traits: [someTrait],
});
```

Zod provides schema reading, not ORM extraction or query interception.

## Trait Graph Validation

ScheML treats `config.traits` as a dependency graph, not just a flat list.

- use `traits: [otherTrait]` with object references when one trait depends on another
- config loading validates the full graph before command execution
- duplicate names, missing references, and cycles fail fast as configuration errors
- training order is derived from dependencies, so prerequisite traits run before dependents

When you run `scheml train --trait someTrait`, ScheML includes `someTrait` together with its dependencies and trains the resulting closure in topological order.

## Trait Kinds

### Predictive

Use for regression or classification outputs backed by ONNX.

### Temporal

Use for windowed sequence traits that compile to ONNX-backed inference.

### Anomaly

Use for anomaly scoring against a baseline feature set.

```typescript
const userAnomaly = defineTrait('User', {
  type: 'anomaly',
  name: 'userAnomaly',
  baseline: ['spend', 'sessions', 'refundRate'],
  sensitivity: 'medium',
});
```

### Similarity

Use for nearest-neighbour retrieval.

```typescript
const productSimilarity = defineTrait('Product', {
  type: 'similarity',
  name: 'productSimilarity',
  on: ['price', 'rating', 'categoryAffinity'],
});
```

Runtime usage:

```typescript
const matches = await session.predictSimilarity('productSimilarity', product, {
  price: (p) => p.price,
  rating: (p) => p.rating,
  categoryAffinity: (p) => p.categoryAffinity,
}, { limit: 5 });
```

### Generative

Use for prompt-contract metadata backed by a configured AI provider. These traits describe context and output shape, are validated during `scheml train`, and execute at runtime through `predictGenerative()` rather than ONNX.

## Feature Resolvers

Feature resolvers are pure functions that extract scalar values from entities.

Supported scalar outputs:

- `number`
- `boolean`
- `string`
- `Date`
- `null` or `undefined` when covered by imputation

Examples:

```typescript
createdAt: (user) => user.createdAt
region: (user) => user.country
isActive: (user) => user.lastActiveAt > thirtyDaysAgo
bio: (user) => user.profile?.bio ?? null
```

Patterns that remain problematic for static extraction:

- dynamic property keys
- opaque helper calls
- array indexing with unstable semantics
- iterative aggregation hidden inside unrelated helper functions

ScheML provides `analyzeFeatureResolver()` for conservative static analysis and `validateHydration()` for shape validation.

## Categorical Features

String features compile into a stored categorical contract. Depending on the trait and contract fitting path, ScheML may use label, hash, or one-hot encoding.

The important rule is that runtime normalization reuses the exact compiled contract from metadata.

## Null Handling

Nullable values need a valid imputation path in the compiled contract. Common strategies are:

- `constant`
- `mean`
- `median`
- `mode`

## Quality Gates

Quality gates define the minimum acceptable trained artifact quality.

```typescript
qualityGates: [
  { metric: 'rmse', threshold: 500, comparison: 'lte' },
  { metric: 'precision', threshold: 0.8, comparison: 'gte' },
]
```

If a gate fails during training:

- artifact generation aborts
- `scheml train` exits non-zero
- no new artifact should be treated as valid

Current enforcement scope:

- predictive and temporal traits enforce gates against reported test metrics during training
- anomaly, similarity, and generative traits do not yet provide evaluable training metrics for gate enforcement
- if you configure `qualityGates` on those unsupported trait types, `scheml train` fails fast with a configuration error

## Batch Predictions

Batch inference validates the full batch before execution and fails atomically.

```typescript
const result = await session.predictBatch('userLTV', users, {
  createdAt: (u) => u.createdAt,
  signupSource: (u) => u.signupSource,
  plan: (u) => u.plan,
});
```

## Troubleshooting

### Schema Drift

If runtime loading throws `SchemaDriftError`, the current adapter-resolved entity hash does not match the stored artifact `schemaHash`.

Typical fixes:

1. Regenerate the artifact with `scheml train` after intentional schema changes.
2. Verify you are loading the correct schema source for the selected adapter.
3. Verify the runtime is using the same adapter and entity identity the artifact was compiled with.

### Missing Live Artifacts In `extendClient()`

In live mode, ScheML now treats missing trait metadata as an error. Train the trait or switch to `materialized` mode.

### Similarity Trait Misuse

Similarity traits use `predictSimilarity()`, not `predict()`.
- Any error aborts the entire batch
- No partial results are returned
- Large batches block (you must chunk)

### Materialize Cleanup Guarantees

`scheml materialize` now treats resource cleanup as part of the command contract.

- the prediction session is always disposed after execution
- the adapter extractor is always disconnected after execution
- this cleanup runs on both successful writes and thrown errors

This matters most for adapters that hold open ORM or driver connections during extraction and writeback.

## Error Handling

All errors are typed with structured context:

```typescript
import {
  SchemaDriftError,
  FeatureExtractionError,
  UnseenCategoryError,
  QualityGateError,
} from '@vncsleal/scheml';

try {
  const result = await session.predict('userLTV', user, resolvers);
} catch (error) {
  if (error instanceof SchemaDriftError) {
    // Schema changed since the artifact was compiled
    console.error(`Schema mismatch since compilation`);
    process.exit(1); // FATAL
  } else if (error instanceof UnseenCategoryError) {
    // New category value encountered
    console.error(`New category for feature ${error.context.featureName}:`, error.context.value);
    // Handle gracefully or re-train
  } else if (error instanceof FeatureExtractionError) {
    // Resolver failed
    console.error(`Feature extraction failed: ${error.context.reason}`);
  }
}
```

## Artifact Management

Artifacts are immutable and versioned:

```
.scheml/
  userLTV.metadata.json  ← Semantic contract
  userLTV.onnx           ← Binary model (binary diff may be large)
  userChurn.metadata.json
  userChurn.onnx
```

**Best practices:**
1. Commit artifacts to git
2. Review metadata.json in PRs (shows what changed)
3. Tag releases with trait artifact versions
4. Never manually edit artifacts
5. To update a trait, retrain and commit new artifacts

## Updating Traits

To change a trait:

1. Edit `scheml.config.ts`
2. Run `npm run train`
3. Commit new artifacts
4. Deploy

To change Prisma schema:

1. Run `prisma migrate`
2. Re-train all affected traits (schema hash will change)
3. Commit new artifacts and schema
4. Deploy

If you skip retraining:
- Inference will fail with `SchemaDriftError`
- Application will refuse to make predictions
- This is intentional and safe

## CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/train.yml
name: Train Traits

on: [push]

jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile
      - run: pnpm run train
```

### `FeatureExtractionError`

```text
Model "userLTV", feature "accountAge": Resolver threw: Cannot read property 'createdAt' of null
```

**Solution:** Add null check in resolver.
```typescript
accountAge: (user) => {
  if (!user.createdAt) return 0; // Impute with default
  return Date.now() - user.createdAt.getTime();
}
```

### `QualityGateError`

```
Model "userLTV" quality gate failed: rmse gte 500, got 625
```

**Solution:** The trained artifact doesn't meet the quality bar. Options:
1. Improve features
2. Get more training data
3. Adjust algorithm hyperparameters
4. Loosen quality gate (if acceptable)

Then retrain.
