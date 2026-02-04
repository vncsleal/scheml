# PrisML Feature Specification

## Core Features (MVP)

### 1. Model Definition Language

**Feature:** `defineModel<TModel>(config: ModelDefinition): ModelDefinition`

Allows developers to declaratively specify predictive models with:
- Target Prisma model
- Output field (regression or classification)
- Named feature resolvers (pure functions)
- Algorithm choice + hyperparameters
- Quality gates (build-time constraints)

**Example:**
```typescript
const userLTV = defineModel<User>({
  name: 'userLTV',
  modelName: 'User',
  output: { field: 'value', taskType: 'regression' },
  features: { age: (u) => u.age, isPremium: (u) => u.plan === 'pro' },
  algorithm: { name: 'forest', version: '1.0.0' },
  qualityGates: [{ metric: 'rmse', threshold: 500, comparison: 'lte' }],
});
```

**Status:** ✅ Complete

---

### 2. Prisma Schema Binding

**Feature:** Deterministic schema hashing + runtime validation

Models are bound to a specific Prisma schema via SHA256 hash:
- Normalize schema (remove comments/whitespace)
- Compute SHA256 hash
- Record hash in model metadata
- At runtime, reject predictions if hash differs

**Why:** Prevents silent bugs from schema drift after model compilation.

**Status:** ✅ Complete

---

### 3. Feature Extraction via AST Analysis

**Feature:** Conservative static analysis of feature resolvers

Analyze feature resolver functions to determine:
- What entity fields are accessed
- Which access patterns are supported
- Mark non-extractable patterns

**Supported patterns:**
- Direct property access: `entity.field`
- Optional chaining: `entity.obj?.field`
- Nested access: `entity.a.b.c`
- Array length: `entity.items.length`

**Non-extractable (allowed but runtime-validated only):**
- Dynamic keys: `entity[variable]`
- Array indexing: `entity.array[0]`
- Iteration: `entity.items.map(x => x.value)`
- Opaque function calls

**Status:** ✅ Complete

---

### 4. Feature Encoding & Normalization

**Feature:** Convert resolver outputs to deterministic numeric vectors

Normalizes all scalar types to numeric features:
- `number` → used as-is (validated as finite)
- `boolean` → encoded as 0/1
- `string` → categorical encoding (label or hash mapping)
- `Date` → converted to Unix timestamp
- `null` → imputation (mean, median, mode, constant)

**Constraints:**
- No implicit encoding (must be explicit)
- Unseen categories → hard error at runtime
- All encoding rules serialized in metadata

**Status:** ✅ Complete

---

### 5. CLI: prisml train Command

**Feature:** Compiler driver that orchestrates the entire training pipeline

```bash
prisml train --config ./prisml.config.ts --schema ./prisma/schema.prisma
```

Pipeline:
1. Load and normalize Prisma schema
2. Load model definitions via AST discovery
3. Validate schemas and type definitions
4. Extract training data via Prisma ordered queries
5. Build feature vectors using resolvers
6. Invoke pinned Python training backend (local)
7. Evaluate quality gates on test split
8. Export ONNX + metadata artifacts

**Status:** ✅ Complete (real training backend implemented)

---

### 6. Model Artifacts

**Feature:** Immutable, deterministic artifact pair

Each model compiles to exactly two artifacts:
- `model.onnx` — executable prediction function (binary ONNX format)
- `model.metadata.json` — semantic contract and compatibility info

**Metadata includes:**
- Feature names, order, encoding
- Output shape and task type
- Algorithm and hyperparameters
- Training metrics (hold-out test split only)
- Prisma schema hash (critical for runtime safety)
- Dataset size and split seed
- PrisML version
- Compilation timestamp

**Intended use:** Commit artifacts to git alongside code

**Status:** ✅ Complete (real ONNX generation)

---

### 7. Runtime Prediction Engine

**Feature:** ONNX Runtime integration for in-process predictions

`PredictionSession` manages:
- Model initialization + artifact validation
- Schema hash validation
- Feature extraction from entities
- Single and batch predictions
- ONNX Runtime session lifecycle

**Key properties:**
- Synchronous execution (blocking)
- In-process (no service calls)
- Deterministic outputs
- Atomic batch validation

**Status:** ✅ Complete (ONNX Runtime implemented)

---

### 8. Typed Error Handling

**Feature:** Structured error taxonomy with contextual information

Error hierarchy:
- `PrisMLError` (base)
  - `SchemaValidationError`
  - `SchemaDriftError` ⭐ critical for safety
  - `ModelDefinitionError`
  - `FeatureExtractionError`
  - `HydrationError`
  - `UnseenCategoryError`
  - `ArtifactError`
  - `QualityGateError`
  - `ONNXRuntimeError`
  - `EncodingError`
  - `ConfigurationError`

All errors include:
- Error code
- Descriptive message
- Structured context (model name, feature path, batch index, etc.)

**Status:** ✅ Complete

---

### 9. Batch Predictions

**Feature:** Process multiple entities atomically

```typescript
const results = await session.predictBatch('modelName', entities, resolvers);
```

Behavior:
- Validates all entities before prediction
- Any validation failure aborts entire batch
- No partial results returned
- Blocking execution (caller must chunk)

**Rationale:** Safety + simplicity. Prevents partial-failure bugs.

**Status:** ✅ Complete

---

### 10. Hydration Contract

**Feature:** Validation that entities have required fields before predictions

Rules:
- `undefined` always fails (field missing)
- `null` allowed only if explicitly declared with imputation
- Empty arrays valid (`.length` is 0)
- No silent fallbacks

**Conservative static analysis** determines required access paths at compile time.

**Strict runtime validation** checks every entity before predictions.

**Status:** ✅ Complete

---

## Non-Features (Explicitly Out of Scope for MVP)

### ❌ Adaptive Learning
No incremental retraining. All learning is at compile time.

### ❌ Runtime Model Selection
No swapping models at runtime or A/B testing.

### ❌ Online Learning
No observation of outcomes in production.

### ❌ Feature Stores
Not a feature serving system. Features are computed in-process.

### ❌ AutoML
No automatic hyperparameter tuning.

### ❌ Experiment Tracking
No experiment versioning or lineage management.

### ❌ Multi-Tenant Support
No built-in schema federation or tenant isolation.

## Algorithm Support (MVP)

Supported algorithms (with pinned versions):
- `linear` — linear regression / logistic regression
- `tree` — single decision tree
- `forest` — random forest
- `gbm` — gradient boosting machine

Algorithms are **pluggable** and **versioned** for determinism.

## Supported Task Types

- `regression` — continuous numeric prediction
- `binary_classification` — two-class classification
- `multiclass_classification` — multi-class classification

## Quality Metrics

Metrics that can be gated:

**Regression:**
- `mse` — mean squared error
- `rmse` — root mean squared error
- `mae` — mean absolute error
- `r2` — coefficient of determination

**Classification:**
- `accuracy` — overall accuracy
- `precision` — true positives / predicted positives
- `recall` — true positives / actual positives
- `f1` — harmonic mean of precision and recall

## Deployment Model

**Build time:** `prisml train`
- Happens in CI/CD
- Outputs artifacts
- Artifacts committed to git
- Exits with error if quality gates fail

**Runtime:** `PredictionSession.predict()`
- Load artifacts from git/filesystem
- Validate schema hash
- Execute predictions in-process
- No external service calls
- Deterministic outputs

## Design Philosophy

**Tradeoff Summary:**

Gain:
- Determinism (no runtime state)
- Correctness (enforced by construction)
- Reviewability (all code in git)
- CI trust (compiled like code)
- Zero infrastructure

Loss:
- Adaptivity (no online learning)
- Flexibility (fixed at build time)
- Experimentation (no A/B tests)
- Dynamism (no runtime decisions)

**Target users:** Developers who prioritize **correctness** and **auditability** over **flexibility** and **experimentation**.
