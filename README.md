# PrisML

Compiler-first machine learning for TypeScript + Prisma.

PrisML is for developers who want a narrow, local, reviewable ML workflow:
- define models in TypeScript
- train them at build time
- commit immutable ONNX + metadata artifacts
- run predictions in process with schema checks

It is not a hosted ML platform, an online learning system, or a runtime experimentation layer.

## Who It Is For

PrisML is aimed at TypeScript and Prisma teams that want:
- deterministic builds
- schema-aware model artifacts
- local inference without adding a separate prediction service
- an ML workflow that can live inside the same repo as application code

## Current Promise

The current package provides:
- `defineModel()` for typed model definitions
- `prisml train` for build-time training
- `prisml check` for schema-only validation
- `PredictionSession` for runtime loading and inference
- immutable `model.onnx` + `model.metadata.json` artifacts

## Quick Start

Install the package:

```bash
npm install @vncsleal/prisml
```

Define a model in `prisml.config.ts`:

```ts
import { defineModel } from '@vncsleal/prisml';

export const userChurnModel = defineModel<User>({
  name: 'userChurn',
  modelName: 'User',
  output: {
    field: 'churned',
    taskType: 'binary_classification',
    resolver: (user) => user.churned,
  },
  features: {
    loginCount: (user) => user.loginCount,
    plan: (user) => user.plan,
    daysSinceSignup: (user) =>
      Math.floor((Date.now() - user.createdAt.getTime()) / 86400000),
  },
  algorithm: {
    name: 'forest',
    version: '1.0.0',
  },
});
```

Train artifacts:

```bash
npx prisml train --config ./prisml.config.ts --schema ./prisma/schema.prisma
```

Run predictions:

```ts
import { PredictionSession } from '@vncsleal/prisml';
import { userChurnModel } from './prisml.config';

const session = new PredictionSession();
await session.load(userChurnModel);

const result = await session.predict(userChurnModel, user);
console.log(result.prediction);
```

## Docs

- [ROADMAP.md](ROADMAP.md) - direction, milestones, OSS path, monetization path
- [MANIFEST.md](MANIFEST.md) - project stance and values
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - technical boundaries and invariants
- [docs/GUIDE.md](docs/GUIDE.md) - usage guide
- [docs/API.md](docs/API.md) - API reference
- [docs/INDEX.md](docs/INDEX.md) - documentation map

## Development

```bash
pnpm install
pnpm --dir packages/prisml test
pnpm --dir packages/prisml build
```

## License

MIT
