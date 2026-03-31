# Getting Started with ScheML

## Installation

```bash
# Runtime + CLI + Python backend (single package)
npm install @vncsleal/scheml
```

Install Python training dependencies (Python 3.9+ required):

```bash
pip install -r node_modules/@vncsleal/scheml/python/requirements.txt
```

> **Note:** Python is only needed at build time for `scheml train`. The runtime prediction engine (`PredictionSession`) is pure Node.js.


## Prerequisites

- Node.js 18+
- TypeScript 5.0+
- Prisma 5.0+
- Python 3.9+ (for training backend)

## 5-Minute Setup

### 1. Create Prisma Schema

```prisma
// prisma/schema.prisma
model User {
  id        String @id @default(cuid())
  email     String @unique
  createdAt DateTime @default(now())
  plan      String // "free", "pro", "enterprise"
  spent     Float @default(0)
}
```

### 2. Define Models

```typescript
// scheml.config.ts
import { defineModel } from '@vncsleal/scheml';

export const userPredictionsModel = defineModel<{
  id: string;
  email: string;
  createdAt: Date;
  plan: string;
  spent: number;
}>({
  name: 'userValue',
  modelName: 'User',
  output: {
    field: 'estimatedValue',
    taskType: 'regression',
  },
  features: {
    accountAge: (user) => {
      const days = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return Math.floor(days);
    },
    plan: (user) => user.plan,
    spent: (user) => Math.max(0, user.spent),
  },
  algorithm: {
    name: 'forest',
    version: '1.0.0',
  },
});
```

### 3. Train

```bash
npm run train
```

This generates:
- `.scheml/userValue.metadata.json`
- `.scheml/userValue.onnx`

### 4. Run Predictions

```typescript
import { PredictionSession } from '@vncsleal/scheml';
import { userPredictionsModel } from './scheml.config';

const session = new PredictionSession();
await session.load(userPredictionsModel);
// Automatically resolves .scheml/userValue.{onnx,metadata.json} and hashes prisma/schema.prisma

const prediction = await session.predict(userPredictionsModel, user);
console.log(prediction.prediction); // e.g., 1500
```

## Next Steps

- See [examples/basic](../examples/basic) for a complete working example
- Read [GUIDE.md](../docs/GUIDE.md) for detailed feature documentation
- Read [API.md](../docs/API.md) for complete API reference
- Read [ARCHITECTURE.md](../docs/ARCHITECTURE.md) for design deep dive

## Troubleshooting

### Models not discovered

Ensure your models use `defineModel()` and are exported from `scheml.config.ts`.

### Schema hash mismatch

Retrain after changing Prisma schema:
```bash
prisma migrate
npm run train
```

### Python backend errors

Ensure Python 3.9+ is installed:
```bash
python --version
```

Ensure Python dependencies are installed:
```bash
pip install -r node_modules/@vncsleal/scheml/python/requirements.txt
```
