# ScheML User Guide

## Prerequisites

### Node.js

Node.js **18 or higher** is required.

### Python (build-time only)

`scheml train` shells out to a Python backend to produce ONNX artifacts. Python is **not** required at runtime \u2014 only during the training/compilation step.

| Requirement | Version |
|---|---|
| Python | ≥ 3.9 |
| numpy | 1.26.4 |
| scikit-learn | 1.5.2 |
| skl2onnx | 1.16.0 |
| onnx | 1.16.0 |

Install the Python dependencies once, before your first `scheml train`:

```bash
pip install -r node_modules/@vncsleal/scheml/python/requirements.txt
```

You can confirm everything is available by running:

```bash
python - <<'EOF'
import numpy, sklearn, skl2onnx, onnx
print(f"numpy        {numpy.__version__}")
print(f"scikit-learn {sklearn.__version__}")
print(f"skl2onnx     {skl2onnx.__version__}")
print(f"onnx         {onnx.__version__}")
EOF
```

This same check runs automatically in CI on every push via the [`ci.yml`](../.github/workflows/ci.yml) workflow.

---

## Installation

```bash
npm install @vncsleal/scheml
```

`@vncsleal/scheml` is the only package — it includes the runtime prediction engine, CLI (`scheml train`, `scheml check`), and Python training backend.

---

## Quick Start

### 1. Define Models

Create `scheml.config.ts` with your model definitions:

```typescript
import { defineModel } from '@vncsleal/scheml';

export const userLTVModel = defineModel<User>({
  name: 'userLTV',
  modelName: 'User',
  output: {
    field: 'estimatedLTV',
    taskType: 'regression',
    resolver: (user) => user.actualLTV,
  },
  features: {
    // Account age in days
    accountAge: (user) => {
      const days = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return Math.floor(days);
    },

    // Categorical: one-hot encoded by default
    source: (user) => user.signupSource,

    // Boolean: converted to 0/1
    isPremium: (user) => user.plan === 'premium',
  },
  qualityGates: [
    {
      metric: 'rmse',
      threshold: 500,
      comparison: 'lte',
      description: 'Must predict within $500',
    },
  ],
});
```

### 2. Train

Compile models to immutable artifacts:

```bash
npm run train
```

This:
1. Loads Prisma schema
2. Validates model definitions
3. Extracts training data via Prisma
4. Fits the feature contract from the training split
5. Invokes Python backend
6. Evaluates quality gates
7. Exports `<modelName>.onnx` + `<modelName>.metadata.json` into `.scheml/`

Artifacts are **immutable** and intended to be **committed to git**.

Encoding categories, imputation values, and numeric scaling statistics are part of the compiled feature contract. They are fit during training and stored in `<modelName>.metadata.json` so runtime prediction can reuse the exact same contract.

### 2.5. Validate Schema Contract

Run a schema-only validation in CI or locally:

```bash
scheml check --schema ./prisma/schema.prisma --output ./.scheml
```

This fails on field type or nullability mismatches and warns on dynamic feature paths.

### 3. Run Predictions

Use trained models in your application:

```typescript
import { PredictionSession } from '@vncsleal/scheml';
import { userLTVModel } from './scheml.config';

const session = new PredictionSession();
await session.load(userLTVModel);
// Automatically resolves .scheml/userLTV.{onnx,metadata.json} and hashes prisma/schema.prisma

// Single prediction
const result = await session.predict(userLTVModel, user);
console.log(result.prediction); // e.g., 1500
```

## Feature Resolvers

Feature resolvers are pure functions that extract values from entities.

### Scalar Types

```typescript
features: {
  // Numeric
  revenue: (user) => user.monthlySpend,

  // Boolean → encoded as 0/1
  isActive: (user) => user.lastActiveAt > new Date(Date.now() - 30 * 86400000),

  // String → categorical encoding (one-hot by default)
  region: (user) => user.country,

  // Date → converted to Unix timestamp
  createdAt: (user) => user.createdAt,

  // Null handling
  memberSince: (user) => user.joinDate || null,
}
```

### Supported Patterns

**Direct property access:**
```typescript
name: (user) => user.name
```

**Optional chaining:**
```typescript
bio: (user) => user.profile?.bio
```

**Nested property:**
```typescript
tier: (user) => user.account.subscription.tier
```

**Array length:**
```typescript
tagCount: (user) => user.tags.length
```

**Computed values:**
```typescript
accountAge: (user) => {
  const days = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.floor(days);
}
```

### Unsupported Patterns

[UNSUPPORTED] Dynamic keys:
```typescript
value: (user) => user[fieldName] // NOT EXTRACTABLE
```

[UNSUPPORTED] Array indexing:
```typescript
firstTag: (user) => user.tags[0] // NOT EXTRACTABLE
```

[UNSUPPORTED] Iteration:
```typescript
totalTags: (user) => user.tags.map(t => t.length).sum() // NOT EXTRACTABLE
```

[UNSUPPORTED] Opaque function calls:
```typescript
processed: (user) => processValue(user.value) // NOT EXTRACTABLE
```

## Categorical Features

String features default to one-hot encoding, with training-time categories stored in metadata:

```typescript
features: {
  region: (user) => user.country, // 'US', 'EU', 'APAC'
}

// In metadata (auto-discovered at training time):
encoding: {
  region: {
    type: 'onehot',
    categories: ['APAC', 'EU', 'US']
  }
}
```

**One-hot encoding:**
- Categories sorted alphabetically
- Category list serialized in metadata
- Unseen categories at runtime → all-zero columns
- No false ordinal relationship between categories

## Null Handling

Nulls must be declared and imputed:

```typescript
features: {
  // OK: value can be null, will use imputation
  bio: {
    resolver: (user) => user.profile?.bio,
    imputation: {
      strategy: 'constant',
      value: 'unknown',
    },
  },

  // ERROR: resolver can return null but no imputation
  revenue: (user) => user.revenue, // Could be null!
}
```

**Imputation strategies:**
- `constant` — use fixed value
- `mean` — use training set mean
- `median` — use training set median
- `mode` — use training set mode

## Quality Gates

Define minimum acceptable model quality:

```typescript
qualityGates: [
  {
    metric: 'rmse',
    threshold: 500,
    comparison: 'lte',
    description: 'Regression error must be < $500',
  },
  {
    metric: 'precision',
    threshold: 0.8,
    comparison: 'gte',
    description: 'Precision must be >= 80%',
  },
]
```

**Metrics:**
- Regression: `mse`, `rmse`, `mae`, `r2`
- Classification: `accuracy`, `precision`, `recall`, `f1`

If any gate fails during training:
- Artifact generation **aborts**
- `scheml train` exits with **non-zero code**
- No model is exported
- You must fix the model and retrain

## Batch Predictions

Process multiple entities efficiently with atomic validation:

```typescript
const users = await db.user.findMany({ take: 1000 });

try {
  const result = await session.predictBatch('userLTV', users, {
    accountAge: (u) => ...,
    source: (u) => ...,
  });

  console.log(`All ${result.successCount} predictions succeeded`);

  result.results.forEach((r, i) => {
    console.log(`User ${i}:`, r.prediction);
  });
} catch (error) {
  // Entire batch failed - no partial results
  console.error('Batch validation failed:', error);
}
});
```

**Behavior:**
- Validates all entities before prediction
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
      - run: git add .scheml/
      - run: git commit -m "Update ML artifacts" || true
      - run: git push
```

This ensures models are always trained on latest code and data.

## Troubleshooting

### `SchemaDriftError`

```
Error: Prisma schema hash mismatch: expected abc123, got def456
```

**Solution:** Retrain your models.
```bash
npm run train
```

### `UnseenCategoryError`

```
Model "userLTV", feature "region": unseen category "JP"
```

**Solution:** Model was trained on limited set of categories. Retrain with new data.

### `FeatureExtractionError`

```
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
