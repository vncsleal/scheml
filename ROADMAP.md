# PrisML Roadmap

## Current — v0.1.1

**Release:** March 2026

**Focus:** Prove core concept — compile-first, schema-safe, deterministic ML

**Status:** Single consolidated package (`@vncsleal/prisml@0.1.1`) published to npm. 95 integration tests passing. CI passing. Homepage and demo live at getprisml.vercel.app.

**Key features:**
- `defineModel()` type-safe API
- Schema hashing + runtime validation
- CLI: `prisml train` pipeline
- Runtime inference engine (ONNX Runtime)
- Complete error taxonomy
- Full documentation
- Live demo with churn prediction model

---

## V1.0 — Beta Release (Q3 2026)

**Focus:** Developer experience, adoption, and audit-first positioning

**Implementation priorities:**

1. Audit & Provenance _(the core differentiator — everything else exists in other tools)_

   **Prediction receipts**
   - Hash the ONNX binary at load time in `ModelMetadataLoader` and store as `artifactHash` in `ModelMetadata`
   - Extend `PredictionOutput` with `{ schemaHash, artifactHash, timestamp }` — every prediction is fully traceable to an exact model version and schema version
   - Answers GDPR "right to explanation": you can reconstruct exactly which model version, on which schema version, produced any given prediction
   - Enterprise compliance story: financial services model risk management, healthcare audit trails, any regulated industry that requires explainable automated decisions

   **Training provenance**
   - Record the Prisma model name + `where` clause filters used at train time in `ModelMetadata` — no PII, just the query shape: _"trained on Users where `plan = 'pro'`, 1,847 rows, seed 42, 2026-03-09"_
   - Closes the audit loop: artifact + schema + training query are all captured at compile time

   **Feature importances**
   - For `forest` and `gbm`, emit `model.feature_importances_` from the Python backend alongside `{ metrics, onnxPath }` — 2 lines of Python
   - Store in `ModelMetadata`; surface in `prisml inspect` and prediction receipts

   **CLI: `prisml inspect <modelName>`**
   - Print artifact summary: algorithm, schema hash, artifact hash, training metrics, top feature importances, training provenance
   - Reads from `.prisml/<name>.metadata.json`; accepts `--artifactsDir` override

   **CLI: `prisml diff <model> <artifact-v1> <artifact-v2>`**
   - Compare two `metadata.json` files: which features changed, which metrics changed, whether the schema hash changed
   - Pure JSON comparison — cheap to build, high signal for teams doing model review or CI promotion gates

2. Developer experience
   - `prisml init` scaffold command — generate boilerplate `defineModel` + schema file
   - `prisml check` — dry-run schema hash check without training ✅ **shipped in v0.1.1**
   - `prisml check --strict` — also runs `tsc --noEmit` against the model config file, validating that feature resolvers are type-safe after a `prisma generate`; the "fail loudly at CI time, not at runtime" story taken to its conclusion
   - Actionable error messages that link to docs (taxonomy exists, messages should guide resolution)
   - Browser-based playground (extend demo page architecture)

3. Quality & hardening
   - Unit tests (core types, encoding, errors)
   - Regression suite
   - Performance benchmarks
   - Security audit

4. Publishing & process
   - SemVer versioning discipline
   - Changelog automation
   - Release process documentation

**Breaking changes:** None expected

---

## V2.0 — Multi-Model Release (Q1–Q2 2027)

**Focus:** Support multiple models per project and explicit version control

**New features:**

### Source-Agnostic Model Definition

The current `modelName` field in `ModelDefinition` is Prisma-specific (`modelName: 'User'`). To avoid a breaking change before any non-Prisma adapter ships, V2 must rename this field to decouple the type from Prisma:

| Option | Signature | Notes |
|---|---|---|
| `source.entity` | `source: { entity: 'User', adapter?: ... }` | Cleanest long-term shape; groups adapter config together |
| `schema.model` | `schema: { model: 'User' }` | Groups with `schemaHash`; natural read |
| `entity` | `entity: 'User'` | Flat and simple; loses the Prisma connotation immediately |

**Recommendation:** `source.entity` — it names the concept ("entity in a data source") without inferring ORM semantics, and leaves a natural home for per-model adapter config (`source.adapter`) when V3 ships.

**Breaking change:** Yes, but contained to the `defineModel()` call only. Any V1 code that sets `modelName: 'Foo'` becomes `source: { entity: 'Foo' }`. The rename should ship at V2.0 with a codemod.

### Named Model Loading
- Multiple named models in one project (`session.load('churn')`, `session.load('ltv')`)
- Per-model artifact isolation
- Typed inference results per model

### Version Pinning
- Pin model version in `defineModel()` — forces explicit upgrades
- Prevents silent schema drift across deployments
- Clear upgrade path with migration guide

### Incremental Retraining
- Hot-reload model updates
- Gradual schema migrations
- Zero-downtime model updates
- Model version compatibility layer

### Multi-Tenant Schemas
- Support heterogeneous Prisma schemas
- Per-tenant model isolation
- Shared model inference
- Schema federation layer

### Prisma Client Extensions Auto-Extraction
- Intercept Prisma query results and automatically map them to the feature vector — no manual field mapping required
- **Implementation note:** `$use()` middleware is deprecated in Prisma 5+. The correct path is the **`model` component of `$extends`**, which adds typed methods directly on each model's namespace. This is idiomatic under the current Prisma Extensions API and is fully supported in Prisma 5.22.0 (the version pinned in this repo).
- ```ts
  // Option A: session.runFromPrisma() — accepts a PrismaPromise directly
  // Does NOT require $extends or middleware. Just awaits the PrismaPromise and runs inference.
  const result = await session.runFromPrisma(
    userChurnModel,
    prisma.user.findUnique({ where: { id } })
  )

  // Option B (preferred): Client Extensions model component — more idiomatic
  const prismaWithPrisML = prisma.$extends(
    prisml.extension({ session, models: { User: userChurnModel } })
  )
  // Adds prisma.user.predict() and prisma.user.predictBatch()
  const result = await prismaWithPrisML.user.predict({ id })
  ```
- Option A is the simpler V2 deliverable — it just awaits a `PrismaPromise<T>`, no `$extends` plumbing required
- Option B ships as a follow-on in V2 or V3 — it requires publishing a `prisml.extension()` factory and fitting into the Prisma Extensions `DynamicModelExtensionArgs` type shape
- Schema hash validates the feature mapping at build time — missing or renamed fields fail loudly, not silently
- Only possible because PrisML owns both the schema definition and the inference layer — no other framework can offer this

### Python Backend Hardening
- Add XGBoost and LightGBM as algorithm options — current scikit-learn GBM is slower and weaker, not suitable for hub-quality templates
- Move preprocessing pipeline (encoding, scaling, imputation) into Python, fit on train split only — **this is the most critical correctness gap in v0.1.x**: the current TypeScript encoding path breaks the fit-on-train-only guarantee
- Add cross-validation based evaluation — single train/test split metrics are unreliable on small datasets
- Configurable train/test split ratio per model definition
- ~~Fix silent `None` return in `build_model()` when algorithm is unmatched~~ ✅ **already raises `ValueError` in v0.1.1**
- This is a prerequisite for Model Hub (V3) and the expanded task types below

### Expanded Task Types (gated on Python backend hardening)

**Anomaly Detection** (`taskType: "anomaly"`)
- Isolation Forest, One-Class SVM
- Seed-fixed and schema-safe — fully deterministic, ONNX-exportable
- Output: anomaly score + binary flag per row
- Primary use cases: fraud detection, infrastructure alerting, outlier flagging

**Uncertainty Quantification**
- Not a new task type — enriches output of existing regression and classification models
- Regression: prediction intervals via quantile regression or conformal prediction
- Classification: calibrated probabilities (Platt scaling, isotonic regression)
- Output schema gains `confidence` and `interval` fields alongside the existing prediction
- Lets products surface "how confident is this?" rather than just a point estimate

**Ranking** (`taskType: "ranking"`)
- LambdaMART (via XGBoost ranker) — deterministic, ONNX-exportable
- Schema defines a `group` field (e.g. session, user) and a relevance label
- Output: ranked score per row, stable sort within group
- Primary use cases: recommendation feeds, search result ordering, lead prioritisation

**Low-priority / deferred to V2 based on usage signals:**
- `defineFeatures()` helper — a typed identity function (`return resolvers`) that lets users name and share feature bundles across models. The maintenance problem it solves (resolvers duplicated across 3+ models of the same source type) is real, but the workaround is sufficient at v0.x: `const baseFeatures: Record<string, FeatureResolver<Product>> = { ... }`. Adding this only makes sense if adoption data shows a meaningful share of users running ≥3 models on the same source type. The API surface cost (public symbol, docs, changelog) is not worth it earlier.

**Explicitly out of scope for V2:**
- Online learning / feedback loops — conflicts with compile-first determinism guarantee
- A/B testing and gradual rollout — premature without stable multi-model base
- Clustering — random initialisation means cluster label semantics shift between runs, breaking the determinism guarantee at the semantic level
- Time series forecasting — needs new schema primitives (`defineTimeSeries()`) to model temporal structure correctly; flagged for research, not yet scheduled
- NLP / text features — embeddings are heavy, schema-safety over free text is hard to enforce meaningfully

**Backward compatibility:** Full. V1 code works unchanged with V2.

---

## V3.0 — Ecosystem Release (2027+)

Potential areas:
- **Edge runtime support** — run inference in Cloudflare Workers / Deno Deploy (onnxruntime-web WASM path already exists)
- Feature store integration (external feature serving, lineage tracking)
- Multi-model ensemble support
- Explainability / SHAP integration
- Fairness & bias detection
- Causal inference primitives
- GraphQL / REST API layer
- Distributed inference
- Hardware acceleration (GPU/TPU)

### Model Hub (V3, requires Python backend hardening from V2)

A registry of community-contributed model templates — each pairing an opinionated `defineModel()` config with a pre-chosen algorithm and hyperparameter defaults:

```bash
prisml add churn       # XGBoost classification, common SaaS features
prisml add ltv         # quantile regression, revenue prediction
prisml add lead-score  # gradient boosting, CRM features
prisml add fraud       # isolation forest, transaction features
```

Each template includes:
- `defineModel.ts` — feature definitions, algorithm + hyperparameter config
- `schema.example.prisma` — example Prisma schema to adapt from
- The Python backend executes the algorithm — no Python exposure required

The hub encodes the "which algorithm for which problem" decision that most developers don't want to make. Users adapt the schema and run `prisml train` — the template handles the rest.

**Algorithm selection is config-driven, not code-driven.** No escape hatch in this version — swapping the Python pipeline is out of scope until the hub has proven adoption.

**Prerequisite:** Python backend must support XGBoost/LightGBM, proper preprocessing pipelines, and cross-validation before hub templates can be credible.

---

## Adapter Architecture (V3.0+)

**Core insight:** The compile-first guarantee doesn't depend on Prisma specifically — it depends on the existence of a **static, typed schema**. PrisML starts with Prisma because `schema.prisma` is the cleanest static artifact to parse and hash. But the same guarantee applies anywhere data has a defined shape.

The long-term architecture is a `PrisMLAdapter` interface: a schema provider (defines the shape and produces the hash) + a data provider (produces the rows for training). Any source that satisfies both can power a PrisML model.

**V2 requirement:** `defineModel()` must be designed source-agnostic at the type level from V2 onward — even before any non-Prisma adapter ships. Getting this wrong means a breaking change later.

### Adapter priority

**V3 — First-class adapters:**

| Adapter | Schema source | Why |
|---|---|---|
| **Drizzle** | TypeScript table definitions | Closest philosophy to Prisma — explicit, typed, no magic. Fast-growing ecosystem. |
| **Zod** | Zod schema object | Removes the ORM requirement entirely. Opens PrisML to any JS/TS project with typed data, regardless of database. |
| **dbt** | `manifest.json` | Data teams are the primary enterprise ML buyers. Already think in schemas and pipelines — natural fit. |

**V3+ — Broader reach:**

| Adapter | Schema source | Notes |
|---|---|---|
| **GraphQL SDL** | `.graphql` schema file | Well-defined, static, widely used across stacks |
| **OpenAPI** | `openapi.yaml` / `openapi.json` | Broadest reach — any REST API with a spec |
| **Avro / Protobuf** | Schema Registry | Enterprise event-driven architectures (Kafka) |
| **Parquet / Arrow** | File schema | Data science / warehouse workflows |

**Community adapter interface (V3+):**
- Publish `@vncsleal/prisml-adapter` as a standalone interface package
- Community can implement adapters without depending on core internals
- Adapter registry in docs

### What this changes about the product story

PrisML is not a Prisma plugin. It is the compile-first ML layer for any typed data source. Prisma is where it starts because the static schema file makes the guarantee easiest to implement and explain — but the architecture is designed to generalise from day one.

> **Note:** This is an early-stage concept. The shape, scope, and implementation will change considerably as the core product matures. Treat everything here as directional, not a commitment.

**Concept:** Managed inference endpoints for teams that don't want to operate their own edge function or server. The compile-first, schema-safe workflow stays intact — the hosted layer just handles the endpoint.

```bash
prisml deploy
# → Uploads userChurn.onnx + metadata.json
# → Returns: https://infer.prisml.dev/m/abc123

curl -X POST https://infer.prisml.dev/m/abc123 \
  -d '{ "tenure_months": 24, "plan": "pro" }'
# → { "churn_probability": 0.18, "label": "low_risk" }
```

**Key properties:**
- Schema hash travels with the artifact — the endpoint rejects payloads that don't match the deployed schema version (compile-time safety guarantee enforced at the API layer)
- Version-addressed URLs — deploying a new artifact never silently breaks existing callers
- No infra knowledge required — `prisml deploy` is the entire workflow

**CLI surface (draft):**
- `prisml deploy` — upload current artifacts, get endpoint URL
- `prisml ls` — list deployed models
- `prisml logs <id>` — tail inference logs
- `prisml rm <id>` — delete endpoint

**Statistical drift — handled by process, not by the runtime:**

Schema hashing catches structural drift (renamed column, changed type). Statistical drift — where the schema is unchanged but real-world input distributions shift away from training data — is handled by scheduled retraining:

- **Self-hosted:** cron triggers `prisml train` against fresh Prisma data on a schedule. CI deploys the new artifacts. Schema hash validates correctness at every step.
- **Hosted (future concept):** scheduled retraining as a product feature — configure a cron, point it at your data source, PrisML re-trains and hot-swaps the artifact automatically. This is what would eventually transform hosted inference from a managed endpoint into a lightweight managed ML pipeline.

**Security model:**

This is a no-data-custody architecture. Training data never leaves your environment — `prisml train` runs locally and produces only the ONNX artifact and schema hash. The hosted layer only ever receives:
- The model weights (a mathematical function, no raw records)
- The schema metadata (feature names, types, hash)
- Inference-time feature vectors from callers

What this means in practice:
- GDPR/CCPA compliance surface is narrower — no PII dataset stored on PrisML infra
- Stronger posture than SaaS platforms that require uploading your training dataset

Honest caveats:
- Model weights are not public-safe — model inversion techniques can approximate training data distributions from weights. The artifact must be treated as sensitive: uploaded over TLS, stored encrypted at rest, access-controlled.
- Inference payloads (feature vectors) may still contain sensitive values (e.g. age, income bracket) even without being raw records — the endpoint must not log or store them by default.

**Monetisation path (tentative):**
- Free tier: 1 active model, 10k requests/month
- Paid: multiple models, higher RPS, custom domains, team access, scheduled retraining

**Dependencies:** Requires stable V2 named model loading + V3 edge runtime work before this is feasible.

---

## Non-Goals

- Replacing feature stores (out of scope)
- ML platforms like MLflow (out of scope)
- AutoML (intentionally excluded)
- Deep learning frameworks (not suitable for this model)
- Real-time model serving (use KServe / BentoML)
- Online / continual learning (conflicts with determinism guarantee)

---

## Success Metrics

By V1.0:
- [x] Deterministic predictions with reproducible artifacts
- [x] Schema safety enforced (no silent drift)
- [x] Production-ready Python backend
- [x] 100+ lines of documentation
- [x] Working examples (regression + classification)
- [x] 95 integration tests passing
- [x] Published to npm
- [x] CI/CD passing
- [x] Live demo deployed
- [ ] `prisml init` scaffold command
- [x] `prisml check` dry-run command ✅ **shipped in v0.1.1**
- [ ] Actionable error messages with doc links

By V2.0:
- [ ] Multiple named models per project
- [ ] Version pinning in `defineModel()`
- [ ] Multi-tenant schema support
- [ ] Ecosystem adoption (5+ external models)
- [ ] Community contributions

---

## Release Cadence

- **v0.1.1:** Mar 2026 ✅ (published to npm, demo live)
- **V1.0 (Beta):** Q3 2026
- **V1.x (Maintenance):** Q4 2026
- **V2.0 (Multi-Model):** Q1–Q2 2027
- **V3.0 (Ecosystem):** 2027+

---

## Compatibility Promise

**Artifact compatibility:**
- ONNX models are forward-compatible
- Metadata schema is versioned
- Breaking changes require major version bump
- Clear migration guides provided

**API compatibility:**
- Semantic versioning enforced
- Deprecation warnings 2 releases before removal
- Community feedback drives decisions

---

## Community & Contributions

- Open source from day one (V1.0)
- RFC process for major features
- GitHub discussions for feedback
- Regular sync with Prisma team
