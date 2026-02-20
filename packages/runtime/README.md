# @vncsleal/prisml-runtime

ONNX Runtime prediction engine for PrisML - compiler-first machine learning for TypeScript + Prisma.

## Features

- In-process ONNX inference
- Schema drift detection
- Single and batch predictions
- Type-safe error handling
- Synchronous, deterministic execution

## Installation

```bash
npm install @vncsleal/prisml-runtime
```

## Usage

```typescript
import { PredictionSession, hashPrismaSchema } from '@vncsleal/prisml-runtime';

const session = new PredictionSession();
const schemaHash = hashPrismaSchema(schemaContent);

// Initialize model
await session.initializeModel(
  './.prisml/model.metadata.json',
  './.prisml/model.onnx',
  schemaHash
);

// Single prediction
const result = await session.predict('modelName', entity, {
  price: (e) => e.price,
  stock: (e) => e.stock,
});

console.log(result.prediction); // Predicted value

// Batch predictions
const results = await session.predictBatch('modelName', entities, resolvers);
```

## Error Handling

All errors extend `PrisMLError` with structured context:

```typescript
import { SchemaDriftError, UnseenCategoryError } from '@vncsleal/prisml-runtime';

try {
  await session.predict('model', entity, resolvers);
} catch (error) {
  if (error instanceof SchemaDriftError) {
    // Handle schema mismatch
  }
}
```

## Documentation

See [main documentation](../../README.md) and [user guide](../../docs/GUIDE.md).

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
