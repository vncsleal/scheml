# ScheML API Reference

## @vncsleal/scheml

Single production dependency. Includes the runtime prediction engine, type system, CLI (`scheml train`, `scheml check`), and Python training backend.

```bash
npm install @vncsleal/scheml
```

### Types

#### `ModelDefinition<TModel>`

Complete specification of a predictive model.

```typescript
interface ModelDefinition<TModel = any> {
  // Name of the model
  name: string;
  
  // Target Prisma model (e.g., 'User', 'Expense')
  modelName: string;
  
  // Output field specification
  output: {
    field: string;
    taskType: 'regression' | 'binary_classification' | 'multiclass_classification';
    resolver?: OutputResolver<TModel>;
  };
  
  // Named feature resolvers (pure functions over entities)
  features: Record<string, FeatureResolver<TModel>>;
  
  // Algorithm choice (pinned version)
  algorithm: AlgorithmConfig;
  
  // Build-time quality gates
  qualityGates?: QualityGate[];
  
  // Computed at compile time
  schemaHash?: string;
}
```

#### `TaskType`

```typescript
type TaskType = 'regression' | 'binary_classification' | 'multiclass_classification';
```

#### `AlgorithmConfig`

```typescript
interface AlgorithmConfig {
  // Algorithm name: 'linear', 'tree', 'forest', 'gbm'
  name: string;
  
  // Pinned version for determinism
  version: string;
  
  // Hyperparameters
  hyperparameters?: Record<string, unknown>;
}
```

#### `QualityGate`

```typescript
interface QualityGate {
  metric: 'mse' | 'rmse' | 'mae' | 'accuracy' | 'precision' | 'recall' | 'f1';
  threshold: number;
  comparison: 'gte' | 'lte';
  description?: string;
}
```

#### `ImputationRule`

```typescript
interface ImputationRule {
  strategy: 'mean' | 'median' | 'mode' | 'constant';
  value?: number | string | boolean;
}
```

#### `CategoryEncoding`

```typescript
interface CategoryEncoding {
  type: 'label' | 'hash';
  mapping?: Record<string, number>;
}
```

#### `ModelMetadata`

Immutable contract generated at compile time.

```typescript
interface ModelMetadata {
  version: string;
  metadataSchemaVersion: string;
  
  modelName: string;
  taskType: TaskType;
  
  algorithm: AlgorithmConfig;
  
  features: {
    features: EncodedFeature[];
    count: number;
    order: string[];
  };
  
  output: {
    field: string;
    shape: number[];
  };
  
  encoding: Record<string, CategoryEncoding | undefined>;
  imputation: Record<string, ImputationRule | undefined>;
  
  // Normalized Prisma schema SHA256 hash
  prismaSchemaHash: string;
  
  trainingMetrics?: TrainingMetrics[];
  dataset?: TrainingDataset;
  
  compiledAt: string; // ISO timestamp
}
```

### Functions

#### `defineModel(config: ModelDefinition): ModelDefinition`

Declare a predictive model. Pure specification with no side effects.

```typescript
import { defineModel } from '@vncsleal/scheml';

const userValue = defineModel<User>({
  name: 'userValue',
  modelName: 'User',
  output: {
    field: 'predictedValue',
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

#### `hashPrismaSchema(schema: string): string`

Compute SHA256 hash of normalized Prisma schema.

```typescript
import { hashPrismaSchema } from '@vncsleal/scheml';

const hash = hashPrismaSchema(schemaContent);
// "abc123def456..."
```

#### `validateSchemaHash(expected: string, actual: string): { valid: boolean }`

Validate schema hash consistency.

```typescript
const result = validateSchemaHash(expected, actual);
if (!result.valid) {
  throw new SchemaDriftError(expected, actual);
}
```

#### `analyzeFeatureResolver(sourceCode: string, functionName?: string): FeatureAnalysis`

Analyze feature resolver for static extractability.

```typescript
import { analyzeFeatureResolver } from '@vncsleal/scheml';

const analysis = analyzeFeatureResolver(
  'const resolver = (user) => user.profile?.name;',
  'resolver'
);

if (!analysis.isExtractable) {
  console.warn(`Analysis issues:`, analysis.issues);
}
```

#### `normalizeFeatureVector(features, schema, encodings, imputations): number[]`

Normalize feature dictionary to numeric vector.

```typescript
import { normalizeFeatureVector } from '@vncsleal/scheml';

const vector = normalizeFeatureVector(
  { age: 30, isPremium: true },
  schema,
  encodings,
  imputations
);
// [30, 1]
```

### Errors

All errors extend `ScheMLError` and include structured context.

```typescript
import {
  ScheMLError,
  SchemaDriftError,
  FeatureExtractionError,
  UnseenCategoryError,
  QualityGateError,
} from '@vncsleal/scheml';

try {
  // ...
} catch (error) {
  if (error instanceof SchemaDriftError) {
    console.error('Schema mismatch:', error.context);
  }
}
```

## CLI

### `scheml train`

Compiler driver: loads models, trains, exports artifacts.

```bash
scheml train \
  --config ./scheml.config.ts \
  --schema ./prisma/schema.prisma \
  --output ./.scheml \
  --python local
```

**Options:**
- `--config, -c` — Path to model definitions (default: `./scheml.config.ts`)
- `--schema, -s` — Path to Prisma schema (default: `./prisma/schema.prisma`)
- `--output, -o` — Output directory (default: `./.scheml`)
- `--python` — Backend: `local` (default: `local`)

**Output:**
- `{output}/{modelName}.metadata.json` — Metadata contract
- `{output}/{modelName}.onnx` — ONNX binary

### `scheml check`

Schema-only validation. Validates feature dependencies against the Prisma schema without running training. Fast CI-friendly check (no Python required).

```bash
scheml check --schema ./prisma/schema.prisma --output ./.scheml
```

## `PredictionSession`

Manages ONNX model sessions and predictions.

#### Constructor

```typescript
const session = new PredictionSession();
```

#### `session.load(model, opts?)`

Load a trained model by resolving `.scheml/{name}.{onnx,metadata.json}` and hashing `prisma/schema.prisma` automatically.

```typescript
import { userLTVModel } from './scheml.config';

await session.load(userLTVModel);
// or with path overrides:
await session.load(userLTVModel, {
  artifactsDir: './.scheml',           // default
  schemaPath: 'prisma/schema.prisma',  // default
});
```

**Throws:**
- `SchemaDriftError` — if schema hash doesn't match the compiled artifacts
- `ArtifactError` — if artifacts are missing or invalid

#### `session.initializeModel(metadataPath, onnxPath, prismaSchemaHash)` _(low-level)_

Explicit path-based initializer. Prefer `session.load()` for most use cases.

```typescript
await session.initializeModel(
  './artifacts/model.metadata.json',
  './artifacts/model.onnx',
  'abc123...'
);
```

**Throws:**
- `SchemaDriftError` — if schema hash doesn't match
- `ArtifactError` — if artifacts missing or invalid

#### `session.predict<T>(model, entity): Promise<PredictionOutput>`

Run prediction on a single entity using the resolvers declared in `model.features`.

```typescript
const result = await session.predict(userLTVModel, user);
console.log(result.prediction); // e.g., 1500
```

#### `session.predict<T>(modelName, entity, resolvers): Promise<PredictionOutput>` _(low-level)_

String-based overload. Requires the model to be initialized via `initializeModel()` first.

```typescript
const result = await session.predict('userLTV', user, {
  accountAge: (u) => Date.now() - u.createdAt.getTime(),
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
- `ArtifactError` — if model not initialized
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

Release ONNX session for a model.

```typescript
await session.dispose('userLTV');
```

#### `session.disposeAll(): Promise<void>`

Release all sessions.

```typescript
await session.disposeAll();
```

## Error Examples

### Schema Drift

```typescript
try {
  await session.load(userLTVModel);
} catch (error) {
  if (error instanceof SchemaDriftError) {
    console.error('Schema mismatch since model compilation');
    console.error('Expected:', error.context.expectedHash);
    console.error('Actual:', error.context.actualHash);
  }
}
```

### Feature Extraction

```typescript
try {
  const result = await session.predict(userLTVModel, user);
} catch (error) {
  if (error instanceof FeatureExtractionError) {
    console.error(`Feature "${error.context.featureName}" failed`);
    console.error(`Reason: ${error.context.reason}`);
  }
}
```

### Unseen Category

```typescript
try {
  const result = await session.predict(userLTVModel, user);
} catch (error) {
  if (error instanceof UnseenCategoryError) {
    console.error(`Unseen category "${error.context.value}" for feature "${error.context.featureName}"`);
  }
}
```
