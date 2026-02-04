# PrisML Architecture

## Overview

PrisML is a compiler-first ML library that treats machine learning as a build-time process, not a runtime service.

```
TypeScript Model Definitions
            ↓
        prisml train (CLI)
            ↓
    ONNX + Metadata
            ↓
    Runtime Predictions
```

## Core Concepts

### Model Definitions (`@prisml/core`)

Models are pure declarative specifications using `defineModel()`:

```typescript
import { defineModel } from '@vncsleal/prisml';

const model = defineModel<User>({
  name: 'userValue',
  modelName: 'User',
  output: {
    field: 'estimatedValue',
    taskType: 'regression',
  },
  features: {
    accountAge: (user) => Date.now() - user.createdAt.getTime(),
    isPremium: (user) => user.plan === 'premium',
  },
  algorithm: {
    name: 'forest',
    version: '1.0.0',
  },
});
```

**Constraints:**
- No data access in definitions
- No training logic
- No side effects
- Pure functions for feature resolvers

### Prisma Schema Binding

Every model is bound to a specific Prisma schema via SHA256 hash:

1. Schema is normalized (whitespace, comments removed)
2. SHA256 hash is computed during compilation
3. Hash is recorded in `model.metadata.json`
4. At runtime, predictions are rejected if schema hash differs

This prevents silent bugs from schema drift.

### Compilation Pipeline (`@prisml/cli`)

`prisml train` executes:

1. **Load & Validate**
   - Load Prisma schema
   - Load model definitions via AST discovery
   - Validate TypeScript types

2. **Resolve Defaults**
   - Normalize feature resolver names
   - Resolve algorithm versions
   - Resolve quality gates

3. **Extract Training Data**
   - Initialize PrismaClient
   - Execute ordered query (via Prisma primary keys)
   - Hydrate entities using lazy-loading/selection

4. **Feature Engineering**
   - Run feature resolvers on each entity
   - Build deterministic feature vectors
   - Apply categorical encoding (label or hash)
   - Apply imputation rules

5. **Train Model**
  - Invoke pinned Python backend (local)
   - Train algorithm on feature matrix
   - Evaluate on hold-out test split

6. **Evaluate Quality Gates**
   - Compute metrics: RMSE, accuracy, precision, F1
   - Compare against thresholds
   - Abort if any gate fails (exit non-zero)

7. **Export Artifacts**
   - Write `model.onnx` (binary ONNX model)
   - Write `model.metadata.json` (semantic contract)
   - Intended to be committed to git

### Feature Extraction Analysis

Feature resolvers are analyzed via TypeScript AST inspection:

**Extractable patterns:**
- Direct property access: `user.name`
- Optional chaining: `user.profile?.bio`
- Nested access: `user.account.tier.level`
- Array length: `user.tags.length`

**Non-extractable patterns:**
- Dynamic keys: `user[variable]`
- Array indexing: `user.array[0]`
- Iteration: `user.items.map(x => x.value)`
- Opaque function calls

Non-extractable patterns are:
- Marked as warnings
- Allowed to compile
- Validated strictly at runtime only

### Feature Encoding & Normalization

All resolver outputs are normalized to numeric vectors:

**Scalar types supported:**
- `number` → used as-is (validated as finite)
- `boolean` → encoded as 0/1
- `string` → categorical encoding (label or hash)
- `Date` → converted to Unix timestamp

**Categorical encoding:**
- Label encoding: category → integer code (mapping serialized)
- Hash encoding: category → hash(value) % 1000
- Unseen categories at runtime → hard error

**Imputation rules:**
- Declared per feature
- Validated at compile time
- Serialized into metadata
- Applied identically in training and predictions
- Strategies: `mean`, `median`, `mode`, `constant`

**No implicit encoding:** All encoding is explicit and deterministic.

### Runtime Predictions (`@prisml/runtime`)

At runtime:

1. Load metadata from `model.metadata.json`
2. Validate Prisma schema hash
3. Initialize ONNX Runtime session (one per model, cached)
4. Extract features from entity
5. Normalize to feature vector
6. Invoke ONNX prediction
7. Return prediction

**Determinism guarantees:**
- Same input + same artifacts → same output
- Within numeric guarantees of underlying platforms (ONNX, Python)
- No random number generation in predictions

**Batch predictions:**
- Explicit batch support
- Atomic preflight validation
- Blocking execution (caller must chunk)
- Any failure aborts with no partial results

### Error Handling

Typed error hierarchy:

- `PrisMLError` — base class
  - `SchemaValidationError` — invalid Prisma schema
  - `SchemaDriftError` — schema hash mismatch
  - `ModelDefinitionError` — invalid model definition
  - `FeatureExtractionError` — resolver failed
  - `HydrationError` — missing required fields
  - `UnseenCategoryError` — unseen category value
  - `ArtifactError` — artifact missing/corrupt
  - `QualityGateError` — quality gate failed
  - `ONNXRuntimeError` — ONNX execution failed
  - `EncodingError` — feature encoding failed
  - `ConfigurationError` — environment misconfigured

All errors include structured context:
- Model name
- Feature path (if applicable)
- Batch index (if applicable)
- Root cause

## Artifact Format

### model.metadata.json

```json
{
  "version": "0.1.0",
  "metadataSchemaVersion": "1.0.0",
  "modelName": "userLTV",
  "taskType": "regression",
  "algorithm": {
    "name": "forest",
    "version": "1.0.0",
    "hyperparameters": { }
  },
  "features": {
    "features": [
      {
        "name": "accountAge",
        "index": 0,
        "originalType": "number"
      }
    ],
    "count": 3,
    "order": ["accountAge", "signupSource", "isPremium"]
  },
  "output": {
    "field": "estimatedLTV",
    "shape": [1]
  },
  "encoding": {
    "signupSource": {
      "type": "label",
      "mapping": {"organic": 0, "paid": 1, "referral": 2}
    }
  },
  "imputation": { },
  "prismaSchemaHash": "abc123...",
  "trainingMetrics": [
    {
      "metric": "rmse",
      "value": 425.5,
      "split": "test"
    }
  ],
  "dataset": {
    "size": 10000,
    "trainSize": 8000,
    "testSize": 2000,
    "splitSeed": 42,
    "materializedAt": "2024-02-03T12:34:56Z"
  },
  "compiledAt": "2024-02-03T12:34:56Z"
}
```

### model.onnx

Binary ONNX model file. Deterministic within platform guarantees.

## Design Tradeoffs

### Gains

- **Determinism:** No runtime state mutation
- **Correctness:** Enforced by construction
- **Reviewability:** All model code in git, all training logged
- **CI Trust:** Models compiled like code
- **Zero Infrastructure:** In-process, no service overhead

### Intentional Losses

- **Adaptive Learning:** No incremental retraining
- **Experimentation:** No runtime model selection or A/B tests
- **Runtime Flexibility:** Model behavior fixed at build time
- **Feature Stores:** No external feature serving

These are non-negotiable MVP tradeoffs. V2 may relax some constraints.

## Directory Structure

```
prisml/
  packages/
    core/           # defineModel, types, schema hashing
    cli/            # prisml train command
    runtime/        # ONNX predictions, error handling
    python/         # Python training backend
  examples/
    basic/          # Full working example
  docs/
    ARCHITECTURE.md # This file
    API.md          # API reference
    GUIDE.md        # User guide
```

## Getting Started

See [examples/basic](../examples/basic) for a complete example.

```bash
# Install
npm install

# Build all packages
npm run build

# Run example
cd examples/basic
npm run train
npm run predict
```
