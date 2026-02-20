# @vncsleal/prisml-generator

Prisma generator for PrisML schema annotations - compiler-first machine learning for TypeScript + Prisma.

## Overview

Parses `@prisml` annotations from Prisma schema comments and generates type-safe TypeScript constants for application-level ML configuration.

## Installation

```bash
npm install @vncsleal/prisml-generator --save-dev
```

## Usage

### 1. Add to Prisma Schema

```prisma
generator prisml {
  provider = "prisml-generator"
  output   = "./generated"
}

model Product {
  id    Int    @id
  price Float
  
  /// @prisml: model="ProductSalesV2" threshold=0.9 fallback=0
  predictedSales Float?
}
```

### 2. Generate

```bash
npx prisma generate
```

This creates `./prisma/generated/prisml.schema.ts`:

```typescript
export const PrisMLAnnotations = {
  'Product.predictedSales': {
    model: "ProductSalesV2",
    threshold: 0.9,
    fallback: 0,
  },
} as const;
```

### 3. Import in Application

```typescript
import { PrisMLAnnotations } from './prisma/generated/prisml.schema.js';

const config = PrisMLAnnotations['Product.predictedSales'];

// Use in prediction logic
const prediction = await session.predict(config.model, product);
const value = prediction.confidence >= config.threshold 
  ? prediction.value 
  : config.fallback;
```

## Annotation Syntax

```
@prisml: model="ModelName" threshold=0.9 fallback=0
```

**Fields:**
- `model` (string): References model name from `prisml.config.ts`
- `threshold` (number): Confidence threshold for using predictions
- `fallback` (number|string|boolean): Default value when prediction rejected

## Type Safety

The generated file uses `as const` to provide:
- Literal type inference for annotation keys
- Readonly deeply nested objects
- Full TypeScript autocomplete and type checking

## Philosophy

**Separation of Concerns:**
- **Training config** (`prisml.config.ts`) → ML engineers define models
- **Application hints** (Prisma schema) → App developers configure usage
- **Generated constants** → Type-safe bridge between schema and code

Annotations are **not** auto-loaded by CLI commands. They serve as documentation and application-level configuration only.

## Documentation

See [main documentation](../../README.md) and [user guide](../../docs/GUIDE.md).

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
