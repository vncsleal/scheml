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
- `defineTrait()` for typed trait definitions (predictive, anomaly, similarity, sequential, generative)
- `defineConfig()` for project configuration
- `scheml train` for build-time training
- `scheml check` for schema-only validation
- `extendClient()` for runtime Prisma integration with trait fields
- `PredictionSession` for low-level ONNX inference
- immutable `<trait>.onnx` + `<trait>.metadata.json` artifacts

## Quick Start

Install the package:

```bash
npm install @vncsleal/scheml
```

Define a trait in `scheml.config.ts`:

```ts
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const churnRisk = defineTrait('User', {
  type: 'predictive',
  name: 'churnRisk',
  target: 'churned',
  features: ['loginCount', 'plan', 'daysSinceSignup'],
  output: { field: 'churnScore', taskType: 'binary_classification' },
  qualityGates: [{ metric: 'f1', threshold: 0.85, comparison: 'gte' }],
});

export default defineConfig({
  adapter: 'prisma',
  traits: [churnRisk],
});
```

Train artifacts at build time:

```bash
npx scheml train --config ./scheml.config.ts --schema ./prisma/schema.prisma
```

`scheml train` performs a preflight pass before dataset materialization and Python handoff. Unsupported algorithms, unsupported hyperparameters, and missing Python dependencies fail early with actionable errors.

The training step compiles a feature contract into metadata: categorical encodings, imputation values, and scaling rules are fit during training and replayed at inference time.

Run predictions at runtime via the Prisma extension:

```ts
import { extendClient } from '@vncsleal/scheml';
import { prisma } from './lib/prisma';
import config from './scheml.config';

const client = await extendClient(prisma, config);

// Trait fields are available on query results
const user = await client.user.findFirst({ where: { id: userId } });
console.log(user.churnScore); // predicted probability
```

For direct ONNX inference without the ORM layer:

```ts
import { PredictionSession } from '@vncsleal/scheml';

const session = new PredictionSession();
await session.initializeModel(
  '.scheml/churnRisk.metadata.json',
  '.scheml/churnRisk.onnx',
  schemaHash
);

const result = await session.predict('churnRisk', user, {
  loginCount: (u) => u.loginCount,
  plan: (u) => u.plan,
  daysSinceSignup: (u) => Math.floor((Date.now() - u.createdAt.getTime()) / 86400000),
});
console.log(result.prediction);
```

## Docs

- [ROADMAP.md](ROADMAP.md) - direction, milestones, OSS path, monetization path
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
