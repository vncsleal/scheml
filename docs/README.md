# PrisML Documentation

## Overview

**PrisML** enables type-safe ML predictions directly from your Prisma database. Define features in TypeScript, train with Python/scikit-learn, deploy with ONNX in Node.js.

## Quick Reference

### Installation
```bash
npm install prisml
```

### Basic Usage

#### 1. Define Model
```typescript
// ml/churn.ts
import { defineModel } from 'prisml';

export const churnModel = defineModel({
  target: 'User',
  output: 'churnProbability',
  features: {
    daysSinceLastLogin: {
      type: 'Float',
      resolve: (user) => {
        const now = new Date();
        const lastLogin = new Date(user.lastLogin);
        return (now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24);
      }
    },
    totalSpent: {
      type: 'Float',
      resolve: (user) => user.totalSpent
    }
  },
  config: {
    algorithm: 'RandomForest',
    minAccuracy: 0.75
  }
});

churnModel.name = 'churnPredictor';
```

#### 2. Train
```bash
npx prisml train -f ml/churn.ts
```

**What happens:**
- Extracts training data from your Prisma database
- Trains model using Docker (or local Python)
- Exports ONNX artifact to `prisml/generated/`
- Fails build if accuracy < minAccuracy

#### 3. Query
```typescript
import { PrismaClient } from '@prisma/client';
import { prisml } from 'prisml';
import { churnModel } from './ml/churn';

const prisma = new PrismaClient().$extends(prisml([churnModel]));

// Fetch user with predictions
const user = await prisma.user.withML({ where: { id: 1 } });

if (user._ml.churnProbability > 0.8) {
  // Send retention email...
}
```

## API Reference

### `defineModel<T>(config)`

Defines an ML model for a Prisma entity.

**Parameters:**
- `target`: Prisma model name (e.g., 'User', 'Order')
- `output`: Field name for predictions (e.g., 'churnProbability')
- `features`: Feature definitions with resolve functions
- `config`: Training configuration (algorithm, minAccuracy, etc.)

**Returns:** PrisMLModel

### `prisml(models: PrisMLModel[])`

Creates Prisma Client extension for ML predictions.

**Returns:** Prisma extension

**Usage:**
```typescript
const prisma = new PrismaClient().$extends(prisml([model1, model2]));
```

### `prisma.model.withML(args)`

Fetches entity with ML predictions in `_ml` namespace.

**Parameters:**
- `args`: Standard Prisma findUnique arguments

**Returns:** Entity with `_ml` field containing predictions

## Feature Engineering

### Best Practices

**Pure functions**
```typescript
resolve: (user) => user.totalSpent
```

**Handle nulls**
```typescript
resolve: (user) => user.orderCount || 0
```

**Deterministic**
```typescript
resolve: (user) => {
  const REFERENCE_DATE = new Date('2026-01-01');
  return (REFERENCE_DATE.getTime() - user.createdAt.getTime()) / 86400000;
}
```

**Avoid side effects**
```typescript
resolve: (user) => {
  console.log(user.id); // Don't do this
  return user.totalSpent;
}
```

**Avoid non-deterministic**
```typescript
resolve: (user) => Math.random() // Different every time!
```

## Training Configuration

### Environment Setup

**Docker (Recommended)**
```bash
# Docker handles Python automatically
npx prisml train
```

**Local Python**
```bash
pip install scikit-learn onnx skl2onnx xgboost
npx prisml train
```

### Algorithms

- `RandomForest` (default) - Balanced accuracy, fast
- `XGBoost` - Best accuracy, slower
- `LogisticRegression` - Fast, simple
- `DecisionTree` - Interpretable

### Quality Gates

Models automatically fail to train if accuracy < threshold:

```typescript
config: {
  minAccuracy: 0.75  // Build fails if accuracy < 75%
}
```

## Architecture

### Training Flow
```
TypeScript Feature Definitions
         ↓
PrismaDataExtractor (auto-detects fields)
         ↓
Python Training (Docker/local)
         ↓
ONNX Export
         ↓
Commit artifact to git
```

### Runtime Flow
```
Prisma Query
         ↓
Extension withML()
         ↓
ONNX Inference (<10ms)
         ↓
Return entity + _ml
```

## Implementation Status

### Complete (V1.1)
- ONNX inference engine
- Python training pipeline
- Prisma data extractor
- Client extension API
- Docker auto-detection
- Quality gates
- Feature processor
- Batch predictions API (`withMLMany`)
- Model versioning

### Planned (Future)
- A/B testing
- Gen Layer (embeddings, LLM)
- GPU acceleration

## Troubleshooting

### "Python not found"
Install Docker Desktop (recommended) or Python 3.8+

### "No data found in X table"
Ensure your database has data and DATABASE_URL is correct

### "Unknown field in select"
Check feature resolve functions - they might reference non-existent fields

### Training fails with low accuracy
- Increase training data
- Try different algorithm (XGBoost)
- Add more features
- Check for data quality issues

## Examples

See `/examples` directory:
- `churn-prediction/model.ts` - Binary classification
- `test-extension.ts` - Extension API testing

## License

MIT
