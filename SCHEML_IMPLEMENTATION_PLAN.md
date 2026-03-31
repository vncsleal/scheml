# ScheML — Implementation Plan

> Transforming PrisML into ScheML: signal as a property of the type system.

**Written:** March 31, 2026  
**Status:** Active

---

## What already works (keep, harden)

The current codebase has a solid base that maps directly to the new spec's predictive signal type:

- FLAML AutoML → sklearn → ONNX pipeline
- `onnxruntime-node`-based prediction engine
- Feature encoding (one-hot, standard scaling, imputation)
- Schema hash scoping to model block
- `scheml train` + `scheml check` CLI skeleton
- ONNX artifact + metadata pair as immutable artifact

None of this gets thrown away. The transformation is architectural expansion, not a rewrite.

---

## Phase 1 — Complete the current IMPLEMENTATION_SPEC work

**What:** The in-progress work (ONNX parity, FLAML default, one-hot encoding, schema hash scoping, preflight validation) is already partially implemented in the codebase but flagged as TODO. Finish it before anything else.

**Why first:** Every later phase stacks on this. If the training pipeline isn't stable, signal composition and adapters will inherit broken foundations.

**Deliverables:**

- One-hot encoding default for string features, with `categories[]` stored in metadata
- Standard scaling applied at train time, parameters stored in metadata, applied at inference
- Feature hash contract between train and inference artifacts verified on load
- All TODOs in `IMPLEMENTATION_SPEC.md` marked done
- CI green

---

## Phase 2 — `defineTrait()` API + trait type system

**What:** Introduce `defineTrait()` alongside `defineModel()` (keep `defineModel` as a deprecated alias, don't break existing users). Define the TypeScript types for all five trait classes.

**Types to define:**

```ts
type TraitType = 'predictive' | 'anomaly' | 'similarity' | 'sequential' | 'generative'

interface BaseTraitDefinition {
  type: TraitType
  name: string
  qualityGates?: QualityGate[]
  traits?: TraitDefinition[]  // object references, resolved at graph walk time
}

interface PredictiveTrait<T> extends BaseTraitDefinition {
  type: 'predictive'
  target: keyof T
  features: (keyof T)[]
  algorithm?: AlgorithmConfig
}

interface AnomalyTrait<T> extends BaseTraitDefinition {
  type: 'anomaly'
  baseline: (keyof T)[]
  sensitivity: 'low' | 'medium' | 'high'
}

interface SimilarityTrait<T> extends BaseTraitDefinition {
  type: 'similarity'
  on: (keyof T)[]
}

interface SequentialTrait<T> extends BaseTraitDefinition {
  type: 'sequential'
  sequence: keyof T
  orderBy: keyof T
  target: keyof T
}

interface GenerativeTrait<T> extends BaseTraitDefinition {
  type: 'generative'
  context: (keyof T)[]
  prompt: string
}
```

`defineTrait(entity, config)` — the first argument is **adapter-specific**:
- Prisma: string entity name (`'Customer'`)
- Drizzle: table object (`users` imported from schema)
- Zod: `ZodObject` (`z.object({ ... })`)

This gives TypeScript inference over the actual type in every adapter — features and target fields are validated at compile time against the schema type.

The return value of `defineTrait` carries the feedback API directly — `churnRisk.record()` and `churnRisk.recordBatch()` are methods on the definition object itself, not a separate registration step.

**Trait composition:** `traits: [churnRisk]` — the field takes **object references**, not strings. The trait graph walk is a reference graph, not a name resolution. Error messages must distinguish two distinct failure modes:
- `'trait referenced before definition'` — reference to an uninitialized symbol
- `'cycle detected'` — circular dependency in the graph

A `resolveTraitGraph()` function builds the dependency DAG and runs both checks at config load time — fail loudly before any training starts.

**Deliverables:**

- `src/defineTrait.ts`
- `src/traitTypes.ts` (union type for all five)
- `src/traitGraph.ts` (DAG builder + cycle detection)
- `defineModel` re-exported as deprecated alias
- Full test coverage for composition and cycle detection

---

## Phase 3 — Adapter architecture

**What:** Extract everything Prisma-specific from `train.ts`, `check.ts`, and `schema.ts` into a Prisma adapter. Define the abstract adapter interface. Implement Zod and Drizzle adapters.

**Interface:**

```ts
interface SchemaReader {
  readSchema(source: string): SchemaGraph  // SchemaGraph: typed entity map
  hashModel(modelName: string): string
}

interface DataExtractor {
  extract(trait: TraitDefinition, options: ExtractOptions): Promise<Row[]>
  write?(trait: TraitDefinition, results: InferenceResult[]): Promise<void>  // for materialize
}

interface QueryInterceptor {  // optional per adapter
  extendClient(client: unknown): unknown
}

interface ScheMLAdapter {
  name: string
  reader: SchemaReader
  extractor: DataExtractor
  interceptor?: QueryInterceptor
}
```

**Adapters to implement:**

| Adapter | SchemaReader | DataExtractor | QueryInterceptor |
|---------|-------------|--------------|-----------------|
| Prisma | ✅ (move existing) | ✅ (move existing) | ✅ (`$extends` result layer) |
| Drizzle | ✅ (parse drizzle-schema inference) | ✅ (via `db.select()`) | ❌ (no middleware concept) |
| Zod | ✅ (traverse ZodObject shape) | ❌ (no query layer) | ❌ |
| TypeORM | ✅ (decorator metadata) | ✅ (`getRepository().find()`) | ⏳ (later milestone) |

Adapter is specified in `scheml.config.ts`:

```ts
export default defineConfig({
  adapter: 'prisma',  // or drizzle(db), zod, typeorm
  traits: [churnRisk, fraudScore]
})
```

**`SchemaGraph` replaces `prismaSchemaHash`** as the hash substrate — now `schemaHash` is produced by the adapter's `hashModel()`, making it adapter-agnostic in artifacts and history records.

**Deliverables:**

- `src/adapters/interface.ts`
- `src/adapters/prisma.ts` (extracted from existing code)
- `src/adapters/drizzle.ts`
- `src/adapters/zod.ts`
- `src/adapters/index.ts` (registry)
- Adapter resolution in `train.ts` and `check.ts`
- Adapter detection from `scheml.config.ts`

---

## Phase 4 — Python backend: anomaly + similarity + sequential trait types

**What:** Extend the Python backend to handle the two new trainable tabular trait types, plus sequential v1.

**Anomaly:** Isolation Forest (scikit-learn) for dataset-level anomaly scoring. FLAML doesn't natively support unsupervised tasks, so this is a direct sklearn path. Output: a float score in `[0, 1]` (higher = more anomalous), plus a binary threshold at inference time based on the configured `sensitivity`.

**Similarity:** Two strategies depending on entity count:
- Small datasets (< 50k): exact cosine similarity over a stored embedding matrix
- Large datasets (>= 50k): approximate nearest neighbours via `faiss-cpu`

**Similarity artifacts are not ONNX.** Similarity models do not use sklearn's standard classifier interface and cannot go through `skl2onnx`. The artifact is an explicit pair:
- `.faiss` — FAISS index file (or a `.npy` matrix for small datasets)
- `.metadata.json` — field list, normalization params, entity count, schema hash

Artifact loading in `PredictionSession` must detect trait type and load the correct artifact format. The `src/artifacts.ts` contract defines all artifact shapes.

**Sequential v1 (fixed-window):** Not a sequence model — window-based feature aggregation over the N most recent events. This converts sequential data into a fixed-width tabular input, feeding the existing FLAML → ONNX pipeline. True sequence models (LSTM/Transformer) are explicitly out of scope for v1 and documented as such. This is technically honest.

**New Python modules:**

- `python/train_anomaly.py`
- `python/train_similarity.py`
- `python/train_sequential.py` (window aggregation)
- `python/requirements.txt` additions: `faiss-cpu==1.8.0`, `umap-learn==0.5.6`

TypeScript glue in `train.ts`: route to the correct Python module based on `trait.type`. Artifact format per trait type is documented in a new `src/artifacts.ts` contract.

---

## Phase 5 — Generative traits

**What:** Generative traits are not ML inference — they're structured prompt execution. They don't go through Python at all.

**Architecture:** A generative trait definition is compiled into a prompt template at `defineTrait` time. At inference, `PredictionSession` detects `type: 'generative'`, serializes the `context` fields from the entity into structured JSON, appends the `prompt`, and calls the configured AI provider.

**Provider:** ScheML does not define its own text generation interface. `generativeProvider` accepts the `LanguageModel` type from Vercel AI SDK v6 (`ai` package) — the emerging standard for TypeScript AI providers. Any object satisfying that interface works: `openai()`, `anthropic()`, custom endpoint wrappers.

```ts
import { openai } from '@ai-sdk/openai'
export default defineConfig({
  adapter: 'prisma',
  generativeProvider: openai('gpt-4o'),
  traits: [retentionMessage]
})
```

**Internal AI SDK mapping at inference time:**
- `outputSchema: z.string()` → `generateText` (plain output)
- `outputSchema: z.enum([...])` → `Output.choice({ options: [...] })`
- `outputSchema: z.object({...})` → `Output.object({ schema: ... })`

This happens inside ScheML's generative inference path — the user only provides the Zod `outputSchema` in their trait definition and never calls AI SDK directly.

No provider lock-in, no API key in ScheML's config.

**`scheml train` for generative traits:** Template validation only — confirm all `context` fields exist in the schema, validate the `outputSchema` (must be a Zod schema), verify the provider is configured. No Python invocation. The artifact is a compiled prompt template + `outputSchema` shape + schema hash stored as a JSON file.

---

## Phase 6 — History, auditability, drift

**What:** Every trait definition, training run, and materialization writes a structured record to `.scheml/history/<traitName>.jsonl` (append-only JSONL for cheap immutability).

**History record schema:**

```ts
interface HistoryRecord {
  trait: string
  model: string
  adapter: string
  schemaHash: string
  definedAt: string
  definedBy: string        // "agent:<name>" | "human:<gituser>" | "unknown"
  trainedAt?: string
  artifactVersion: string  // incremented on each train
  qualityGates?: Record<string, { threshold: number; result: number }>
  status: 'defined' | 'trained' | 'drifted' | 'deprecated'
  driftDetectedAt?: string
  driftFields?: string[]
}
```

**`definedBy` detection:** Check `CI` env var + `GITHUB_ACTOR` (CI human), `GITHUB_WORKFLOW` (automation), or a configurable `SCHEML_AUTHOR` env var. Falls back to `git config user.name`. Document that agents should set `SCHEML_AUTHOR=agent:<name>`.

**Drift detection in `scheml check`:** Compare the `schemaHash` stored in the latest history record against the hash of the current schema for that model. If they differ, record `status: 'drifted'` and surface the delta (which fields were added/removed/changed since the artifact was trained).

**Deliverables:**

- `src/history.ts` (read/write JSONL history records)
- `src/drift.ts` (schema delta computation)
- Extended `scheml check` to write drift records
- `scheml train` writes history record on completion

---

## Phase 7 — Extended CLI

**What:** Complete the CLI surface from the spec, with `--json` on everything.

| Command | What it does |
|---------|-------------|
| `scheml train --trait <name>` | Train a single trait (currently trains all) |
| `scheml check` | Drift + quality gate check; `--json` returns structured diff |
| `scheml status --json` | Complete project state: all traits, versions, drift, last metrics |
| `scheml history --trait <name>` | Version history for one trait |
| `scheml migrate` | Generate schema migration for materialized trait columns |
| `scheml materialize --trait <name>` | Batch inference → write to DB column |
| `scheml generate` | Write `scheml.d.ts` extending ORM types with trait properties |
| `scheml audit` | Export full history as verifiable JSON |

`--json` flag: when present, suppress all `ora` spinners and chalk output, write a single JSON object to stdout on success or `{ error: string, code: string }` on failure. Makes every command pipeable and agent-operable.

**`scheml materialize`:** Runs batch inference via `PredictionSession`, then calls the adapter's `DataExtractor.write()` method to persist results. For Prisma: generates an `ALTER TABLE` migration adding a nullable column, runs it, then does batched `UPDATE` calls. Records the operation in history.

---

## Phase 8 — Runtime trait access + client extension

**What:** Make traits accessible as native properties on query results through the adapter's `QueryInterceptor`.

**Prisma mechanism:** The Prisma adapter's `QueryInterceptor` uses `$extends` with a `result` layer. Each trait registered in `scheml.config.ts` becomes a computed field:

```ts
prisma.$extends({
  result: {
    customer: {
      churnRisk: {
        needs: { id: true },
        compute(customer) {
          return predictionSession.predict(customer)
        }
      }
    }
  }
})
```

**Two modes per trait:**

- **Materialized:** reads the pre-computed column directly (zero overhead)
- **Live:** calls `PredictionSession.predict()` on access (lazy, cached with TTL)

The `trait:` filter syntax (`findMany({ trait: { churnRisk: { gt: 0.75 } } })`) is implemented as a query extension that rewrites the filter into the materialized column query or a post-filter on live inference. Materialized is the intended path for production queries; live is a convenience for development.

**Deliverables:**

- `src/adapters/prisma.ts` extended with `QueryInterceptor`
- `src/cache.ts` (TTL cache for live trait values)
- `src/runtime.ts` (`extendClient(client, config)` helper, adapter-agnostic)
- Type generation: `scheml generate` command writes `scheml.d.ts` that extends the ORM's generated types with trait properties

---

## Phase 9 — Feedback loop

**What:** `record()` and `recordBatch()` APIs on the definition object itself for collecting ground truth and measuring accuracy decay.

```ts
// Single record — churnRisk is the signal definition object
await churnRisk.record(customerId, { actual: true })

// Batch form — one round-trip for bulk ground-truth ingestion
await churnRisk.recordBatch([
  { id: customerId1, actual: true },
  { id: customerId2, actual: false },
])
```

Both persist to `.scheml/feedback/<traitName>.jsonl` (append-only JSONL). On `scheml check`, computes current accuracy against the latest artifact's predictions and reports decay. If accuracy falls below the quality gate threshold, emits a warning in check output (structured if `--json`).

This is the last phase because it depends on the full history + artifact system being stable, and it's the only phase that reads back its own prior output.

---

## Execution sequence and dependencies

```
Phase 1 (stabilize baseline)
  └── Phase 2 (defineTrait API)
        ├── Phase 3 (adapters) ──────────────── Phase 7 (CLI extensions)
        │     └── Phase 8 (runtime)                   │
        ├── Phase 4 (Python: anomaly/similarity/seq)   │
        ├── Phase 5 (generative)                       │
        └── Phase 6 (history/drift) ──────────────────┘
                                              └── Phase 9 (feedback)
```

Phases 3, 4, 5, and 6 are parallelizable once Phase 2 is complete. Phase 7 can be started incrementally alongside any of them — start with `--json` and `status`, add `materialize` and `history` as their backends land.

---

## End state

A user with a Drizzle schema and no ML background writes:

```ts
// scheml.config.ts
import { defineTrait, defineConfig } from '@vncsleal/scheml'
import { openai } from '@ai-sdk/openai'
import { db, users } from './db/schema'

const churnRisk = defineTrait(users, {
  type: 'predictive',
  name: 'churnRisk',
  target: 'churned',
  features: ['lastLoginAt', 'totalPurchases', 'planTier'],
  qualityGates: [{ metric: 'f1', threshold: 0.85, comparison: 'gte' }]
})

export default defineConfig({
  adapter: drizzle(db),
  generativeProvider: openai('gpt-4o'),
  traits: [churnRisk]
})
```

Runs `scheml train`. Gets a trained ONNX artifact, a structured history record, and query results that carry `user.churnRisk` as a native number. `scheml status --json` returns everything an agent needs to reason about the project's intelligence state. Schema changes are detected automatically. The entire thing is auditable, versioned, and adapter-agnostic.
