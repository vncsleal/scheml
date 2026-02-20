# @vncsleal/prisml-core

Core type system and utilities for PrisML - compiler-first machine learning for TypeScript + Prisma.

## Features

- Type-safe model definition API (`defineModel`)
- Prisma schema hashing and drift detection
- Feature extraction and encoding types
- Quality gate definitions
- Model metadata contracts

## Installation

```bash
npm install @vncsleal/prisml-core
```

## Usage

```typescript
import { defineModel, TaskType } from '@vncsleal/prisml-core';

export const salesModel = defineModel<Product>({
  name: 'ProductSales',
  modelName: 'Product',
  output: {
    field: 'predictedSales',
    taskType: TaskType.Regression,
    resolver: (p) => p.actualSales,
  },
  features: {
    price: (p) => p.price,
    stock: (p) => p.stock,
  },
  algorithm: {
    name: 'forest',
    version: '1.0.0',
  },
});
```

## Documentation

See [main documentation](../../README.md) and [user guide](../../docs/GUIDE.md).

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
