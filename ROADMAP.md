# PrisML Roadmap

## Current State

The core compiler-first path works end-to-end:

- `defineModel()` declares typed models in TypeScript
- `prisml train` trains at build time and emits `.onnx` + `.metadata.json` artifacts
- `prisml check` validates a model definition without training
- `PredictionSession` loads artifacts and runs in-process inference
- Schema drift detection is operational and enforced at runtime
- Quality gates are evaluated at build time — no artifact is emitted on failure
- Determinism fixes shipped: seeded shuffle with stable row ordering, schema hash order-invariance, ONNX orphan cleanup on gate failure

Known open issues:

- **ONNX runtime mismatch:** training evaluates quality gates with Python `onnxruntime` (native C++), but Node.js inference uses `onnxruntime-web` (WASM). These can diverge numerically on linear and GBM models. Documented in `ONNX_RUNTIME_PARITY.md`.
- **Categorical features unsupported:** string and enum features fail or silently encode to `0`. Only numeric and boolean features work.
- **AST static analysis stubbed:** `analyzeFeatureResolver()` always returns `isExtractable: true`. Runtime validation is used instead.
- **Compiler output is raw:** errors surface as stack traces; no structured success summary after `prisml train`.

---

## Steps

### ONNX Runtime Parity

**Goal:** close the determinism gap between training and inference.

The quality gate is evaluated under Python `onnxruntime` but production inference runs under `onnxruntime-web` (WASM). For linear and GBM models this can produce different numeric results for the same input, which breaks the core audit guarantee.

Changes:
- Switch Node.js inference to `onnxruntime-node` as the default entrypoint
- Expose an explicit `/edge` entrypoint that uses `onnxruntime-web` for Edge Runtime environments
- Document the parity caveat in the `/edge` entrypoint and in `ONNX_RUNTIME_PARITY.md`

Done when:
- `prisml train` and `session.predict()` use the same ONNX execution backend in the default path
- The `/edge` entrypoint clearly documents when and why numeric results may differ

---

### Categorical Feature Support

**Goal:** make string and enum features first-class.

String and enum features must not silently encode to `0` or fail opaquely.

Changes:
- Hash encoding as the default for `String` features
- Label encoding for `Enum` features with a known value set (derived from Prisma schema)
- Encoding strategy recorded in `metadata.featureSchema` per feature

Done when:
- A `String` or `Enum` field in `defineModel()` trains and infers without error
- The encoding strategy is visible in artifact metadata
- Changing encoding strategy requires retraining and produces a different artifact hash

---

### Compiler Output

**Goal:** make `prisml train` usable without reading source code.

Changes:
- Structured summary after a successful `prisml train`: feature count, sample count, algorithm, quality gate result
- Formatted, actionable error messages for known failure modes: unsupported feature type, quality gate failed, schema file not found, Python backend not available

Done when:
- `prisml train` prints a one-screen summary on success with no stack trace
- Every documented error code produces a message that tells the user what to fix

---

### Hardened Package

**Goal:** a stable, trustworthy narrow tool with a frozen public API.

No new features — only the public contract and documentation bar are set here.

#### Public API Contract

These interfaces are stable and will not make breaking changes without a major version bump:

- `defineModel()` — model definition
- `PredictionSession` — artifact loading and inference
- `prisml train` — build-time training
- `prisml check` — build-time validation
- `.onnx` + `.metadata.json` artifact format (schema versioned)

#### Guarantees

- `prisml train` on the same code and data produces functionally identical artifacts
- Schema drift causes a hard runtime failure with the expected and actual hash
- Quality gate failure produces no artifact (ONNX file is deleted before rethrowing)
- All public error codes are documented with causes and remediation steps

#### Documentation

- Quickstart covers the full workflow: define → train → commit → predict
- API reference covers every public export
- Architecture guide explains the compile-time/runtime boundary and what is forbidden at runtime
- All known limitations are documented honestly and prominently

Done when:
- A TypeScript developer unfamiliar with PrisML can complete the quickstart without asking for help
- No public claim in the docs contradicts actual behavior

---

### Declarative Power

**Goal:** widen what can be expressed in `defineModel()` without adding runtime state or infrastructure.

Each item must be reflected in artifact metadata and must require retraining when changed.

- **Imputation strategies:** `impute: 'zero' | 'mean' | 'median'` declared per feature in `defineModel()`
- **Regression metrics:** `mae` and `r2` available in quality gates alongside `rmse`
- **Derived features:** simple arithmetic expressions on other features declared inside `defineModel()`
- **Multi-model configs:** multiple `defineModel()` exports in one `prisml.config.ts`, trained in a single `prisml train` pass

Done when each item:
- Is expressible in TypeScript with no new CLI flags
- Is enforced at build time with a loud error if violated
- Is captured in artifact metadata so the artifact is self-describing

---

### Auditability

**Goal:** make artifact provenance a usable, visible feature.

This is the strongest differentiation argument for PrisML in regulated or review-conscious workflows.

- **`prisml audit <artifact>`:** prints a human-readable provenance report — training timestamp, schema hash, feature list, algorithm, quality gate result, Git commit (if available)
- **`prisml diff <artifact-a> <artifact-b>`:** shows what changed between two artifacts — schema, features, algorithm, metrics
- **JSON output flag (`--json`):** machine-readable output for CI integration
- **Artifact manifest:** optional checksum over the full artifact bundle, verifiable without retraining

Done when:
- A reviewer can answer "what data shape was this model trained on, and did it pass its quality gates?" without reading source code
- `prisml audit` output is stable enough to diff in CI

---

### Later

Directional only.

- AST static analysis for feature resolvers (replaces the current runtime stub)
- Source-agnostic adapters (non-Prisma data sources)
- Remote training backend (offload Python to a managed service)
- Model registry UI (hosted artifact browser and review workflow)

None of these belong in the core package without demonstrated user need.

---

## What Is Out of Scope — Permanently

These are not deferred features. They are architectural commitments.

- Online learning or background retraining
- Model hosting or serving infrastructure
- Feature stores
- AutoML or hyperparameter search
- A/B testing or traffic routing
- Runtime model mutation
- Control plane or "active model" state

If a feature requires runtime state, continuous feedback, or infra orchestration, it does not belong in PrisML.
