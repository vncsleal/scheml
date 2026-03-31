# ScheML

Compiler-first machine learning for TypeScript + Prisma.

ScheML is for developers who want a narrow, local, reviewable ML workflow:
- define models in TypeScript
- train them at build time
- commit immutable ONNX + metadata artifacts
- run predictions in process with schema checks

It is not a hosted ML platform, an online learning system, or a runtime experimentation layer.

## Who It Is For

ScheML is aimed at TypeScript and Prisma teams that want:
- deterministic builds
- schema-aware model artifacts
- local inference without adding a separate prediction service
- an ML workflow that can live inside the same repo as application code

## Current Promise

The current package provides:
- `defineModel()` for typed model definitions
- `scheml train` for build-time training
- `scheml check` for schema-only validation
- `PredictionSession` for runtime loading and inference
- immutable `model.onnx` + `model.metadata.json` artifacts

## Quick Start

Install the package:

```bash
npm install @vncsleal/scheml
```

Define a model in `scheml.config.ts`:

```ts
import { defineModel } from '@vncsleal/scheml';

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
});
```

Train artifacts:

```bash
npx scheml train --config ./scheml.config.ts --schema ./prisma/schema.prisma
```

`scheml train` performs a preflight pass before dataset materialization and Python handoff. Unsupported algorithms, unsupported hyperparameters, and missing Python dependencies fail early with actionable errors.

The training step also compiles a train-derived feature contract into metadata: categorical encodings, imputation values, and scaling rules are fit during training and then replayed by `PredictionSession` at runtime.

Run predictions:

```ts
import { PredictionSession } from '@vncsleal/scheml';
import { userChurnModel } from './scheml.config';

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
pnpm --dir packages/scheml test
pnpm --dir packages/scheml build
```

## License

MIT
