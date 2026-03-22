# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-03-21

### Changed

- Version patch to correctly supersede `0.2.0` (which was already occupied on the npm registry by a prior release). No functional changes from the intended `0.2.0` scope below.

## [0.2.0] — 2026-03-21 *(superseded by 0.2.1)*

### Added

- **FLAML AutoML backend** (`python/train.py`): `flaml.AutoML` is now the default training backend with a 60-second time budget. It automatically selects the best estimator across linear models, decision trees, random forests, gradient boosting (LightGBM/XGBoost), and more. The `bestEstimator` field is returned in the Python response and stored in metadata.
- **`algorithm` is now optional** (`types.ts`, `commands/train.ts`): Omitting `algorithm` in `defineModel()` activates FLAML AutoML. Explicit algorithms (`forest`, `gbm`, `linear`, etc.) still work as overrides.
- **One-hot encoding for string features** (`commands/train.ts`, `encoding.ts`): String features now default to `'onehot'` encoding instead of `'label'`. Unseen categories at inference produce all-zero columns. `buildCategories()` is added to compute sorted unique category arrays.
- **Standard scaling for numeric features** (`commands/train.ts`, `encoding.ts`): Mean and standard deviation are computed at train time, stored in the metadata `scaling` map, and applied via `applyScaling()` at inference. Safe for all algorithm families.
- **`hashPrismaModelSubset(schema, modelName)`** (`schema.ts`): New function that hashes only the relevant `model` block plus any referenced `enum` blocks, rather than the entire schema file. Reduces false-positive `SchemaDriftError` when unrelated models change.
- **Python environment preflight** (`commands/train.ts`): `checkPythonEnvironment()` runs before training and fails fast with a `ConfigurationError` if `python3`, `flaml`, `sklearn`, `skl2onnx`, `numpy`, or `onnx` are missing.
- **`flaml==2.3.0`** added to `python/requirements.txt`.
- **`ModelMetadata.bestEstimator`** (optional string): the name of the estimator selected by AutoML, e.g. `"LGBMClassifier"`.
- **`ModelMetadata.scaling`**: map of feature name → `ScalingSpec` stored in metadata for inference-time application.

### Changed

- **`onnxruntime-web` → `onnxruntime-node`** (`package.json`, `prediction.ts`): The correct Node.js ONNX Runtime binding is now used. `onnxruntime-web` is browser/WASM-only and caused silent correctness divergence when running in Node.
- **`load()` backward-compatibility** (`prediction.ts`): `PredictionSession.load()` detects `metadataSchemaVersion` and uses `hashPrismaSchema` for v1.1.0 artifacts, `hashPrismaModelSubset` for v1.2.0+ artifacts. Existing artifacts do not need to be regenerated.
- **FNV-1a 32-bit hash** replaces the toy `sum-of-char-codes % 1000` hash for `'hash'`-strategy category encoding.
- **`metadataSchemaVersion` bumped to `'1.2.0'`** for artifacts produced by this version.
- **`AlgorithmConfig.version` removed**: The field was declared but never used by the Python backend. Existing configs that include it must remove it.

### Removed

- **`ModelRegistry`, `globalModelRegistry`, `registerModel`** (`defineModel.ts`, `index.ts`): Dead code that was never integrated into the training or inference pipeline.

### Breaking

- `AlgorithmConfig.version` is removed from the type. Remove it from any `defineModel()` calls and `ModelMetadata` objects.
- `buildCategoryMapping()` no longer accepts a second `strategy` parameter. The hash-strategy branch is gone; use `buildCategories()` + one-hot encoding instead.
- New `EncodedFeature.columnCount: number` field is required (always `1` for non-onehot features).
- New `ModelMetadata.scaling` field is required in the `ModelMetadata` type (use `{}` if no scaling).

---

## [0.1.2] — 2026-03-09

### Fixed

- **Schema normalization order invariance** (`schema.ts`): `normalizePrismaSchema()` was sensitive to declaration order — running `prisma format` (which reorders fields and models) produced a different SHA-256 hash for semantically identical schemas, causing false `SchemaDriftError` on `session.load()`. The function now sorts field lines alphabetically within each `model`/`enum` block (with `@@` directives after fields), and sorts `model`/`enum`/`type` blocks by name. `datasource`/`generator` blocks are preserved first in original order.

  **Migration:** Existing `.onnx` + `.metadata.json` artifacts must be regenerated with `prisml train`. The stored `prismaSchemaHash` will differ from the hash produced by this version. Tests pinning `KNOWN_SCHEMA_HASH` must be updated to the new value (run `hashPrismaSchema()` against your schema to obtain it).

- **ONNX orphan on quality gate failure** (`commands/train.ts`): When a quality gate failed, the Python backend had already written the `.onnx` file before the gate was evaluated. The gate threw `QualityGateError` and the `.metadata.json` was never written, leaving a dangling `.onnx` with no corresponding metadata. The artifact is now deleted before rethrowing, ensuring no artifact exists without its metadata counterpart.

- **Non-deterministic train/test split** (`commands/train.ts`): `prisma.findMany()` was called without `orderBy`, relying on database-defined row order which is undefined across vacuums, migrations, and engines. The seeded shuffle (`seed = 42`) was operating on a non-deterministic input, producing different train/test splits across runs. Fixed by adding `orderBy: { id: 'asc' }` to enforce a stable row ordering before shuffling.

- **`applyImputation` silent zero return** (`encoding.ts`): The `mean`, `median`, and `mode` imputation branches returned `0` when no precomputed value was present in metadata, silently corrupting feature vectors instead of failing loudly. These branches now throw `"Imputation strategy 'X' requires a precomputed numeric value in metadata"` unless a valid `rule.value` is present.

### Changed

- `AlgorithmConfig.version` JSDoc updated to document that the field is declared but not currently enforced by the Python backend. Reserved for future version pinning.
- Added `orderBy: { id: 'asc' }` to `findMany()` in the training pipeline (see fix above).
- Seed `42` annotated as V2 tech debt — split logic belongs in Python once preprocessing moves there.

### Added

- 5 new tests in `schema.test.ts` covering: field-order invariance, `@@` directive placement after field sorting, model-block-order invariance, and whitespace-only schema handling.
- `ONNX_RUNTIME_PARITY.md` — assessment of the `onnxruntime-web` vs `onnxruntime-node` execution parity gap. Documents divergence risk by algorithm, the quality gate correctness implication, and the fix path (`onnxruntime-node` as default, `onnxruntime-web` as opt-in `/edge` entrypoint). Flagged as a V1 blocker.

---

## [0.1.0] — 2026-03-09

### Changed

- Consolidated `@vncsleal/prisml-core`, `@vncsleal/prisml-runtime`, `@vncsleal/prisml-cli`, and `@vncsleal/prisml-generator` into a single `@vncsleal/prisml` package. All sub-packages are retired.
- New `session.load(model, opts?)` API — resolves `.prisml/` artifacts and `prisma/schema.prisma` automatically from the model definition.
- New `session.predict(model, entity)` overload — resolvers are colocated in `model.features`, no longer passed as a separate argument.
- New `session.predictBatch(model, entities)` overload.
- `prisml check` command included in the single package.
- Python training backend (`python/train.py`) included in `packages/prisml/python/`.
- Package version reset to `0.1.0`.

### Removed

- `@vncsleal/prisml-core` (retired)
- `@vncsleal/prisml-runtime` (retired)
- `@vncsleal/prisml-cli` (retired)
- `@vncsleal/prisml-generator` (retired)

---

## Legacy (Multi-Package Era)

> The entries below document the development history of the multi-package era (`@vncsleal/prisml-core`, `-runtime`, `-cli`). They are preserved for historical context.

## [0.2.3] - 2026-03-08

### Changed

- **`@vncsleal/prisml-runtime`**: `onnxruntime-node` moved from `dependencies` to `peerDependencies`. Consumers must install it explicitly. This prevents npm from nesting `onnxruntime-node` inside `@vncsleal/prisml-runtime/node_modules/`, which blocked Vercel builds by triggering a redundant 101 MB binary download on every cold install.

## [0.2.2] - 2026-03-08

### Added

- **Live demo page** (`/demo`): interactive prediction UI with real ONNX inference running in-process via `@vncsleal/prisml-runtime`; includes latency display, schema drift trigger, and Carbon-inspired dark UI
- **Example Prisma setup**: `examples/basic/prisma/schema.prisma` and `prisma/seed.ts` with `setup-demo` and `train:demo` scripts for reproducible demo artifact generation

### Fixed

- **Classification ONNX export**: `train.py` in `@vncsleal/prisml-cli` now passes `zipmap: False` when exporting classification models. Previously the default `zipmap=True` caused skl2onnx to return a list-of-dicts output tensor instead of a float array, breaking runtime inference for all classification tasks.
- **CLI version**: `prisml --version` now reads the version dynamically from `package.json` at runtime instead of returning a hardcoded `0.1.0`
- **ESLint**: Lint scripts updated with `--ext .ts` flag explicitly, ensuring TypeScript files are linted in all packages
- **Build isolation**: `tsconfig.json` in `@vncsleal/prisml-core` and `@vncsleal/prisml-runtime` now excludes test files from compilation (`src/**/*.test.ts`); `files` arrays in both `package.json`s exclude `dist/**/*.test.*` from npm tarballs
- **CI**: Added `workflow_dispatch` trigger for on-demand manual CI runs; removed stale `packages/python/` (Python backend is bundled inside `@vncsleal/prisml-cli`)

## [0.2.1] - 2026-03-05

### Added

- **Test Coverage**: 95 integration tests across `@vncsleal/prisml-core` and `@vncsleal/prisml-runtime`
  - `schema.test.ts`: schema normalization, SHA256 hashing, hash validation, model parsing (19 tests)
  - `encoding.test.ts`: scalar normalization for all types, category mapping, feature vector ordering (29 tests)
  - `errors.test.ts`: all 10 error classes, correct codes, context fields, `instanceof` chain (32 tests)
  - `prediction.test.ts`: `ModelMetadataLoader` caching, `FeatureExtractor` resolver guards, schema drift detection, uninitialized model guards (15 tests)

- **CI (GitHub Actions)**: `.github/workflows/ci.yml`
  - Matrix tests across Node.js 18, 20, 22 on every push and pull request
  - Dedicated `typecheck` and `lint` jobs
  - **Python ML dependency validation**: explicitly installs and validates `numpy`, `scikit-learn`, `skl2onnx`, `onnx` from pinned `requirements.txt` before running any test — catches broken Python environments in CI before they reach users
  - `pnpm` and `pip` caching for fast re-runs

### Fixed

- `vitest` added to `devDependencies` in `@vncsleal/prisml-core` and `@vncsleal/prisml-runtime` (was only hoisted from root workspace, causing resolution issues when packages are used standalone)

### Changed

- **Publishing model**: `@vncsleal/prisml` now depends only on `@vncsleal/prisml-core` and `@vncsleal/prisml-runtime`. The CLI (`@vncsleal/prisml-cli`) is removed from the umbrella's runtime `dependencies` — it must be installed explicitly as a `devDependency`. This prevents build-time tools (yargs, chalk, ora, ts-node, onnxruntime-node) from being pulled into application bundles. Sub-packages remain individually published for granular control.

## [0.2.0] - 2026-02-20

### Added

- **Extended Metadata Contract (v1.1.0)**: Enhanced model metadata for contract validation
  - `featureDependencies`: Explicit schema field dependencies per feature
  - `tensorSpec`: ONNX tensor metadata (name, shape, type)
  - Backward compatible with v1.0.0 metadata

- **Schema-Only Contract Validation**: New `prisml check` command
  - Validates feature dependencies against Prisma schema without training
  - Detects type mismatches (String vs Float, etc.)
  - Detects nullability mismatches (required field used as nullable)
  - Warns on dynamic features (runtime-only resolution)
  - Fast CI-friendly validation (no Python/training required)

- **Prisma Generator Package**: `prisml-generator` for schema annotations
  - Parses `@prisml` annotations from Prisma schema docstrings
  - Generates type-safe TypeScript constants (`PrisMLAnnotations`)
  - Supports `model`, `threshold`, `fallback` configuration
  - Full `as const` type inference for autocomplete
  - Application-level ML configuration co-located with schema

### Changed

- **Training Command**: Now emits v1.1.0 metadata with feature dependencies
- **ESM Configuration Loading**: Fixed dynamic import handling for "type": "module" packages
- **Default Output Directory**: Changed from `./prisml-artifacts` to `./.prisml` (follows industry standard dotfile pattern like `.next/`, `.nuxt/`)

## [0.1.0-legacy] - 2026-02-04

### Added

- **Core Type System**: Complete type-safe model definition API with `defineModel()`
  - `TaskType` enum: regression, binary_classification, multiclass_classification
  - `AlgorithmConfig` with pinned versions and hyperparameters
  - `QualityGate` for build-time model validation
  - `ModelMetadata` contract for immutable artifacts

- **Prisma Schema Binding**: Deterministic schema hashing and drift detection
  - SHA256 hashing of normalized Prisma schema
  - Runtime schema hash validation with `SchemaDriftError`
  - Prevents inference on schema-drifted models

- **Feature Encoding & Normalization**: Explicit, deterministic feature processing
  - Support for scalar types: number, boolean, string, Date, null
  - Categorical encoding: label and hash strategies
  - Imputation rules: constant, mean, median, mode
  - Unseen category detection with `UnseenCategoryError`

- **Compilation/Training Phase**: Build-time model training via `prisml train`
  - Prisma data extraction via ORM
  - Deterministic feature vector generation
  - Fixed-seed train/test split (80/20, seed=42)
  - Quality gate evaluation on hold-out test set
  - Artifact generation: ONNX + metadata JSON
  - Python backend integration (scikit-learn + skl2onnx)
  - Support for: linear, tree, forest, gbm algorithms

- **Runtime Prediction Engine**: ONNX Runtime integration
  - `PredictionSession` for managing model lifecycle
  - Single predictions: `predict<T>(modelName, entity, resolvers)`
  - Batch predictions with atomic validation: `predictBatch<T>()`
  - Preflight validation ensures no partial execution on error
  - Feature extraction via resolver functions
  - Synchronous, in-process inference

- **Error Handling**: Comprehensive, typed error taxonomy
  - `PrisMLError` base class with structured context
  - Specific error types: SchemaDriftError, HydrationError, UnseenCategoryError, etc.
  - Batch index tracking for debugging

- **CLI**: Compiler driver for model training
  - `prisml train` command with configurable options
  - Status output with spinners and colored logging
  - Quality gate enforcement with non-zero exit on failure
  - Support for config, schema, output, and python backend options

- **Documentation**: Complete API and usage guides
  - API.md: detailed function signatures and examples
  - GUIDE.md: step-by-step user guide with code examples
  - SECURITY.md: safety guarantees and design constraints
  - ARCHITECTURE.md: system design and mental model
  - FEATURES.md: feature specifications and rationale

- **Example Project**: End-to-end example in `examples/basic`
  - Product Sales prediction model
  - Model definition with regression task
  - Training and inference workflows

### Fixed

- **Batch Inference Atomicity**: Implemented atomic two-phase execution
  - Phase 1: Preflight validation of all entities
  - Phase 2: ONNX inference (only if all entities validated)
  - Throws on first failure with batch index context
  - No partial results on error (matches PRD requirement)

- **CLI Build Script**: Removed non-standard chmod workaround
  - Replaced `tsc && chmod +x` with standard shebang + npm bin field
  - npm handles executable bit on install/publish (industry standard)

- **Runtime Naming**: Renamed inference.ts to prediction.ts
  - Aligns with API naming convention (`predict()`, `PredictionSession`)
  - Better semantic consistency across codebase

### Known Limitations

- AST static analysis stubbed (deferred to V1)
  - Feature resolver access paths validated at runtime only
  - Conservative static analysis is out of scope for MVP
- Docker backend option not implemented (local Python only)
  - Deferred to V1 as nice-to-have enhancement
- Hash encoding uses simple sum mod 1000 (deterministic but basic)
  - Will be replaced with MurmurHash3 in V1

### Technical Details

- **Language**: TypeScript 5.3
- **Runtime**: Node.js 18+
- **Build System**: Turbo (monorepo)
- **Package Manager**: pnpm
- **ML Backend**: scikit-learn + ONNX Runtime
- **Type Safety**: Complete end-to-end TypeScript support

### Breaking Changes

None (initial release)

### Contributors

- PrisML Team

---

## Unreleased

### Planned for V1

- Full AST static analysis for feature resolvers
- Docker backend option for Python training
- MurmurHash3 for categorical encoding
- Performance optimizations (batch ONNX inference)
- Advanced feature types (arrays, nested objects)
- Custom imputation strategies

---

[0.1.0]: https://github.com/vncsleal/prisml/releases/tag/v0.1.0
[0.2.3]: https://github.com/vncsleal/prisml/releases/tag/v0.2.3
[0.2.2]: https://github.com/vncsleal/prisml/releases/tag/v0.2.2
[0.2.1]: https://github.com/vncsleal/prisml/releases/tag/v0.2.1
[0.2.0]: https://github.com/vncsleal/prisml/releases/tag/v0.2.0
[0.1.0-legacy]: https://github.com/vncsleal/prisml/releases/tag/v0.1.0-legacy
