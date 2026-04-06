# ScheML User Guide

## Prerequisites

### Node.js

Node.js 18 or higher is required.

### Python

`scheml train` uses the bundled Python backend to produce ONNX models and other training artifacts. Python is required for training, not for normal predictive runtime use.

| Requirement | Version |
|---|---|
| Python | >= 3.9 |
| numpy | 1.26.4 |
| scikit-learn | 1.5.2 |
| skl2onnx | 1.16.0 |
| onnx | 1.16.0 |

Install the Python dependencies once before your first training run:

```bash
scheml check --config ./scheml.config.ts --schema ./prisma/schema.prisma --output ./.scheml
```

This validates that the current schema still matches the emitted artifact contract.

### 4. Run Predictions

Use `PredictionSession` directly:

```typescript
import { PredictionSession } from '@vncsleal/scheml';

const session = new PredictionSession();

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

### `extendClient()`

Use this when you want traits exposed as fields on your ORM client.

Current interceptor-backed adapters:

- Prisma
- TypeORM

Current modes:

- `materialized`
- `live`

Live mode now fails loudly if a live-capable trait is missing its metadata artifact.

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

Use for prompt-contract metadata. These traits describe context and output shape; they are not loaded through ONNX runtime prediction APIs.

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

Quality gates define the minimum acceptable model quality.

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
    // Schema changed since model was compiled
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
3. Tag releases with model versions
4. Never manually edit artifacts
5. To update a model, retrain and commit new artifacts

## Updating Models

To change a model:

1. Edit `scheml.config.ts`
2. Run `npm run train`
3. Commit new artifacts
4. Deploy

To change Prisma schema:

1. Run `prisma migrate`
2. Re-train all models (schema hash will change)
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
name: Train Models

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

**Solution:** Model doesn't meet quality bar. Options:
1. Improve features
2. Get more training data
3. Adjust algorithm hyperparameters
4. Loosen quality gate (if acceptable)

Then retrain.
