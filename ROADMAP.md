# Product Roadmap: ScheML
**Product Vision:** Compiler-first machine learning for TypeScript teams who want deterministic training, immutable artifacts, and local schema-safe inference without a separate ML platform.
**Last Updated:** April 8, 2026 | **Next Review:** June 2026

---

## Product Language Rule

ScheML follows two naming systems on purpose:
- Adapter- and TypeScript-native naming for schema, entities, and trait-definition concepts
- Python-ML-aligned naming and syntax for training, evaluation, metrics, preprocessing, and other ML-layer features

Rule:
- if a feature comes from the adapter/app definition layer, it should feel native to TypeScript and the chosen adapter
- if a feature comes from the ML/training layer, it should bridge toward established Python ML conventions instead of inventing new terminology

This is a design rule for all future ML-facing features.

---

## ✅ SHIPPED — v0.1.0
*All of the below shipped as part of the initial 0.1.0 release (derived from prisml).*

- **ONNX Runtime Parity** — `onnxruntime-node` as the default runtime; train-time and runtime inference use the same ONNX execution family
- **Preflight Training Validation** — unsupported algorithms, invalid hyperparameters, and Python backend readiness all fail before dataset serialization
- **Categorical Feature Hardening** — one-hot encoding for string features, standard scaling for numerics, encoding contract stored in metadata and replayed at inference
- **Compiler Output And Error UX** — typed error hierarchy (`SchemaDriftError`, `QualityGateError`, `FeatureExtractionError`, etc.); preflight failures have clear remediation messages
- **Public Contract Freeze** — `defineTrait()`, `defineConfig()`, `extendClient()`, `PredictionSession`, `createPredictionSession()`, and the artifact pair are the stable narrow public surface
- **Artifact Inspect And Diff Tooling** — `scheml inspect`, `scheml diff`, `scheml status`, `scheml audit`, `scheml history` all ship in the CLI
- **Artifact Identity In Metadata** — every artifact carries trait identity, entity name, schema hash, compiled timestamp, and trait type in a stable metadata shape
- **`scheml init`** — scaffolds a minimal `scheml.config.ts` and `.scheml/` directory with adapter-aware starters
- **Multi-Trait Workflow** — trait dependency graph, topological training order, `--trait <name>` dependency closure, duplicate/cycle detection
- **Five Trait Types** — `predictive`, `anomaly`, `similarity`, `temporal`, `generative`
- **Multi-Adapter Support** — Prisma (schema reader + extractor + interceptor), TypeORM (schema reader + extractor + interceptor), Drizzle (schema reader + extractor, no interceptor), Zod (schema reader only)
- **Schema-Neutral Hashing** — adapter-normalized entity hash replaces Prisma-specific schema hash surface
- **History And Feedback** — append-only JSONL audit trail; accuracy-decay detection from ground-truth observations

---

## 🟢 NOW — Active Development
*Currently in progress. High certainty, locked scope.*

| Horizon | Confidence | Updated |
|---|---|---|
| 0–6 weeks | High | April 8, 2026 |

### Theme: First Adopter Trust

**Initiative:** Compatibility Matrix
- **Problem:** Users cannot tell which combinations of Node, Python, adapter version, and OS are officially tested versus expected to work.
- **Hypothesis:** If ScheML publishes a small, explicit compatibility matrix with support tiers, trust will improve because users will know what is tested, what is expected, and what is unsupported.
- **Target Outcomes:**
  - A clear support policy for Node, Python, Prisma/Drizzle/TypeORM/Zod, and OS is public.
  - Supported, expected, and unsupported environments are distinguished explicitly.
- **Owner:** Vinicius Leal | **Status:** In Design

**Initiative:** Example Library Of Real Use Cases
- **Problem:** No working examples ship with 0.1.0. Users have limited reference points for how ScheML looks in real product scenarios.
- **Hypothesis:** If ScheML ships a small set of realistic examples, adoption will improve because users will see the full define → train → commit → predict workflow in credible contexts.
- **Target Outcomes:**
  - At least two strong example projects (e.g. churn, LTV, recommendation) covering different trait types and adapters.
  - Examples demonstrate the real workflow, not just isolated API snippets.
- **Owner:** Vinicius Leal | **Status:** Not Started

---

## 🟡 NEXT — Scoping & Discovery
*Prioritized and directionally committed. The "why" is locked; the "how" is still forming.*

| Horizon | Confidence | Updated |
|---|---|---|
| 6–16 weeks | Medium | April 8, 2026 |

### Theme: Training And Runtime Depth

**Initiative:** True Batch Inference
- **Problem:** `predictBatch()` is currently all-or-nothing preflight + looped single-row ONNX calls — one `session.run()` per entity with a `[1, N]` tensor. This is correct but not a real batched tensor execution path.
- **Hypothesis:** If ScheML accumulates all feature vectors into a single `[B, N]` Float32Array and calls `session.run()` once per batch, repeated scoring workflows will become more efficient because inference overhead will drop and the API will match the semantics of a real batch.
- **Dependency / Unlock:** Requires verifying that ONNX models exported from the FLAML/skl2onnx pipeline declare a dynamic batch dimension on axis 0. If exported models are fixed to batch size 1, the export pipeline must be updated before the inference path can change. This is the unlock question — not the `predictBatch()` implementation itself.
- **Target Outcomes:**
  - skl2onnx export produces models with a dynamic batch dimension on axis 0.
  - `predictBatch()` uses a single batched tensor execution path.
  - Batch inference becomes a credible workflow for repeated scoring jobs.

**Initiative:** Configurable Training Split And Seed
- **Problem:** ScheML hardcodes split behavior and seed in training. Predictive traits use a random shuffle split (`splitTrainingRows(rows, 42, 0.2)` hardcoded in TypeScript before Python handoff); temporal traits use an ordered holdout (`Math.floor(windows.length * 0.8)` hardcoded, separate code path). Both are internal constants invisible to the user.
- **Hypothesis:** If split ratio and seed become part of the declared training contract at the trait config level, users will get better control and clearer reproducibility because evaluation behavior will be explicit and recorded in artifact metadata rather than implied.
- **Note on scope:** Predictive split (`splitRatio`, `splitSeed`) and temporal split (`testFraction`) are separate code paths and must be addressed independently. Python already receives pre-split arrays — this is a purely TypeScript-side change. The `splitSeed` and `testSize` metadata fields already exist in the artifact contract; `splitRatio` is the only missing recorded field.
- **Target Outcomes:**
  - `splitRatio` and `splitSeed` are configurable in predictive trait config and recorded in artifact metadata.
  - Temporal trait `testFraction` is separately configurable (ordered holdout, not random).
  - Both default to the current hardcoded values so the change is non-breaking.

**Initiative:** Drizzle Query Interceptor
- **Problem:** Drizzle has no client-level middleware equivalent to Prisma's `$extends`, so `extendClient()` is not backed for Drizzle and trait fields cannot be transparently injected on queries. Drizzle users must call `PredictionSession` directly.
- **Hypothesis:** If ScheML ships a `withTraits(db, config)` proxy wrapper for Drizzle, Drizzle users will get a comparable trait-field access pattern without dropping to raw session calls. However, this hypothesis may resolve differently: if the proxy surface is too thin or the ergonomics are worse than direct `PredictionSession` usage, the right outcome may be a documented pattern rather than shipped middleware.
- **Dependency / Unlock:** Requires research into Drizzle's execution layer. The core research question is whether there is a viable interception point — or whether the honest answer is that Drizzle's design intentionally avoids this abstraction layer and direct session usage should be the documented idiom.
- **Target Outcomes:**
  - Research determines the viable interception path (or explicitly rules it out).
  - If a wrapper is viable: Drizzle adapter supports a `withTraits()` contract that adds trait fields to query results.
  - If no viable interception point: Drizzle documentation explicitly covers the `PredictionSession` direct pattern as the first-class idiom.

**Initiative:** `scheml check` Depth
- **Problem:** `scheml check` validates schema hash compatibility but does not validate whether artifact features are still reachable in the current entity schema. A renamed field, removed relation, or changed field type cannot be caught today without retraining.
- **Hypothesis:** If `scheml check` validates feature reachability against the current schema, users will catch structural breakage in CI before training. This is a tractable CI-grade check — comparing the artifact's feature list against current schema fields.
- **Note on scope:** Encoding freshness (are category lists still valid against current data? are scaling stats still representative?) is a data problem, not a schema check. That would require re-extracting rows and belongs to tooling designed around data monitoring, not `scheml check`.
- **Target Outcomes:**
  - `scheml check` compares each artifact's feature list against the fields currently present in the entity schema and fails if any feature is unreachable.
  - Hash mismatch and feature reachability are reported as distinct failure modes with distinct messages.

**Initiative:** Training Data Filters
- **Problem:** Real models often need to train on a deliberate subset of entities — not the full table. "Only churn-predict paying users (not trial)." "Only model users who have been active for at least 30 days." These are row-level predicates on the entity dataset, not a sampling concern. There is no way to express this in v0.1.
- **Hypothesis:** If the trait's training contract supports a filter predicate (akin to a WHERE clause on the entity query), users will be able to train on meaningful cohorts and the artifact will record which filter produced the training data.
- **Note on scope:** This is distinct from development row limits (Development Sampling). Filters are a training correctness concern — the wrong training population produces the wrong model. Sampling is a developer-experience concern — iteration speed on large datasets. These must not be conflated in the design.
- **Target Outcomes:**
  - Trait config supports a training filter predicate for the entity dataset.
  - The filter specification is recorded in artifact metadata alongside the training split.

---

## 🔴 LATER — Future Horizons
*Strategic bets. Low certainty, wide scope. Good ideas parked until the time is right.*

| Horizon | Confidence | Updated |
|---|---|---|
| 16+ weeks | Low | April 8, 2026 |

### Theme: Commercialization And Scope Expansion

**Initiative:** Managed Artifact Governance Layer
- **Problem:** Once teams use ScheML seriously, local artifacts alone do not solve review, approval, provenance visibility, or promotion across environments.
- **Strategic Bet:** This will matter more later because governance becomes painful only after the core package is trusted and used repeatedly.
- **Target Outcomes:**
  - A paid workflow exists around artifact registry, provenance, comparison, review, and promotion.

**Initiative:** Managed Training Workflow
- **Problem:** Some teams will eventually want a managed build path, but hosted training is operationally heavier than artifact governance.
- **Strategic Bet:** Only becomes valuable after the artifact workflow proves useful and demand for managed execution is real.
- **Target Outcomes:**
  - Managed training is defined as an extension of the artifact workflow, not the first commercial layer.

**Initiative:** Development Sampling / Row Limit
- **Problem:** Local iteration may eventually become slow on much larger datasets.
- **Strategic Bet:** Only worth designing once real bottlenecks from large databases are observed.
- **Target Outcomes:**
  - Any design distinguishes development-only sampling from the trusted training path.

---

## ❌ Decided Against
*Explicitly killed ideas — with a reason. Prevents relitigating the same debates.*

| Initiative | Reason Rejected | Date |
|---|---|---|
| Online learning | Conflicts with immutable artifacts and the compile-first model | March 11, 2026 |
| Background retraining in core | Introduces runtime state and orchestration that do not belong in the package | March 11, 2026 |
| Feature store | Low alignment with the core package thesis; turns ScheML into infrastructure | March 11, 2026 |
| AutoML as a user-facing product concern | FLAML is an internal training implementation detail, not a feature ScheML exposes or positions around; surfacing AutoML selection as a first-class product concept pushes ScheML toward generic ML platform behavior | March 11, 2026 |
| A/B testing and traffic routing | Out of scope for the core package. Controlled traffic splitting between artifact versions is a natural extension of the Managed Artifact Governance Layer — not something to design before that foundation exists | March 11, 2026 |
| Runtime model mutation | Breaks determinism and artifact trust | March 11, 2026 |
| Active-model control plane | Out of scope for the core package. "Which artifact version is currently serving" is answered by the Managed Artifact Governance Layer (LATER); it does not belong in the SDK itself | March 11, 2026 |
| Generic model serving infrastructure | Misaligned with the local, artifact-centric product shape | March 11, 2026 |

---
**How to read this roadmap:** NOW is committed. NEXT is directional. LATER is a bet. Nothing here is a promise.
