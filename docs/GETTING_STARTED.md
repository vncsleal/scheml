# Getting Started with PrisML

## Installation

```bash
npm install @vncsleal/prisml
```

For monorepo development, clone and install:

```bash
npm install
```

Install Python training dependencies:

```bash
pip install -r packages/python/requirements.txt
```

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
// prisml.config.ts
import { defineModel } from '@vncsleal/prisml';

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
- `prisml-artifacts/userValue.metadata.json`
- `prisml-artifacts/userValue.onnx`

### 4. Run Predictions

```typescript
import { PredictionSession } from '@vncsleal/prisml';

const session = new PredictionSession();
const schemaHash = '...'; // See docs for how to get this

await session.initializeModel(
  './prisml-artifacts/userValue.metadata.json',
  './prisml-artifacts/userValue.onnx',
  schemaHash
);

const prediction = await session.predict('userValue', user, {
  accountAge: (u) => (Date.now() - u.createdAt.getTime()) / (1000 * 60 * 60 * 24),
  plan: (u) => u.plan,
  spent: (u) => u.spent,
});

console.log(prediction.prediction); // e.g., 1500
```

## Next Steps

- See [examples/basic](../examples/basic) for a complete working example
- Read [GUIDE.md](../docs/GUIDE.md) for detailed feature documentation
- Read [API.md](../docs/API.md) for complete API reference
- Read [ARCHITECTURE.md](../docs/ARCHITECTURE.md) for design deep dive

## Troubleshooting

### Models not discovered

Ensure your models use `defineModel()` and are exported from `prisml.config.ts`.

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
pip install -r packages/python/requirements.txt
```
