# examples/basic

Demonstrates using ScheML to train and run intelligence traits on Prisma-backed data. Two predictive traits are defined against a `User` model: one for lifetime value regression and one for churn classification.

## Prerequisites

- Node.js 20+
- Python 3.9+ with `pip`
- pnpm

Install Python dependencies (one-time, from monorepo root):

```sh
pip install -r packages/scheml/python/requirements.txt
```

## Setup

Install JS dependencies and initialise the SQLite database with demo data:

```sh
pnpm install
pnpm setup-demo   # runs: db:push + generate + seed
```

This creates `prisma/dev.db` with synthetic user records for training.

## Training

```sh
pnpm train
```

Trains the traits defined in `scheml.config.ts` and outputs compiled artifacts to `.scheml/`:

```
.scheml/
├── userLTV.onnx
├── userLTV.metadata.json
├── userChurn.onnx
└── userChurn.metadata.json
```

## Inference

```sh
pnpm infer    # runs src/infer.ts using the trained artifacts
```

## Traits

### `userLTVTrait` — User Lifetime Value

| Field | Value |
|---|---|
| Task | Regression |
| Algorithm | Random Forest (`forest`) |
| Output field | `estimatedLTV` |
| Quality gate | RMSE ≤ 500 |

Features: `accountAge` (days), `signupSource` (categorical), `monthlySpend` (numeric), `isPremium` (boolean).

### `userChurnTrait` — Churn Prediction

| Field | Value |
|---|---|
| Task | Binary classification |
| Algorithm | Gradient Boosting (`gbm`) |
| Output field | `predictedChurn` |
| Quality gates | Precision ≥ 0.80, Recall ≥ 0.75 |

Features: `daysSinceActive`, `monthlySpend`, `supportTickets`.

## Website Demo Artifacts

To generate demo artifacts for the getscheml.vercel.app live demo:

```sh
pnpm train:demo
```

This trains the demo traits and writes artifacts to `../../apps/website/demo-artifacts/` instead of `.scheml/`.

## Project Layout

```
examples/basic/
├── prisma/
│   ├── schema.prisma    # User model schema
│   └── seed.ts          # Demo data seed script
├── src/
│   ├── index.ts         # Usage instructions entry point
│   └── infer.ts         # Inference example
└── scheml.config.ts     # Trait definitions (userLTVTrait, userChurnTrait, engagementSequenceTrait)
```
