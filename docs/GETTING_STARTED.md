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
- An ORM adapter: Prisma 5.0+, Drizzle 0.29+, TypeORM 0.3+, or Zod 3.0+ (all optional peer dependencies — install whichever you use)
- Python 3.9+ (for training backend only)

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

### 2. Define Traits

```typescript
// scheml.config.ts
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const userValue = defineTrait('User', {
  type: 'predictive',
  name: 'userValue',
  target: 'estimatedValue',
  features: ['createdAt', 'plan', 'spent'],
  output: {
    field: 'estimatedValue',
    taskType: 'regression',
  },
  // algorithm is optional — omit to let FLAML AutoML choose automatically
  qualityGates: [
    { metric: 'r2', threshold: 0.80, comparison: 'gte' },
  ],
});

export default defineConfig({
  adapter: 'prisma',
  traits: [userValue],
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

**Via Prisma extension (recommended):**

```typescript
import { extendClient } from '@vncsleal/scheml';
import { prisma } from './lib/prisma';
import config from './scheml.config';

const client = await extendClient(prisma, config);

// Trait fields are available on query results
const user = await client.user.findFirst({ where: { id } });
console.log(user.estimatedValue); // predicted value
```

**Via direct ONNX session (advanced):**

```typescript
import { PredictionSession } from '@vncsleal/scheml';

const session = new PredictionSession();
await session.loadTrait('userValue', {
  artifactsDir: '.scheml',
  schemaPath: './prisma/schema.prisma',
  adapter: 'prisma',
});

const result = await session.predict('userValue', user, {
  createdAt: (u) => u.createdAt.getTime(),
  plan: (u) => u.plan,
  spent: (u) => Math.max(0, u.spent),
});
console.log(result.prediction); // e.g., 1500
```

## Next Steps

- Read [GUIDE.md](../docs/GUIDE.md) for detailed feature documentation
- Read [API.md](../docs/API.md) for complete API reference
- Read [ARCHITECTURE.md](../docs/ARCHITECTURE.md) for design deep dive

## Troubleshooting

### Traits not discovered

Ensure your traits are defined with `defineTrait()` and included in the `traits` array of `defineConfig()` exported from `scheml.config.ts`.

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
