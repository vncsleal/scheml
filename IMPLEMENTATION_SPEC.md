# Architecture Overhaul — Implementation Spec

> Historical planning document. The work described here has already landed; use `README.md`, `docs/ARCHITECTURE.md`, `docs/GUIDE.md`, and `CHANGELOG.md` for the current package contract.

**Branch:** `architecture/flaml-automl-overhaul`  
**Goal:** Make scheml deliver on its promise — a Prisma developer with no ML expertise declares *what* to predict, the library handles *how*.

---

## Change Index

| # | Area | File(s) | Status |
|---|------|---------|--------|
| 1 | Fix wrong ONNX runtime | `package.json`, `prediction.ts` | ✅ DONE |
| 2 | Make `algorithm` optional + FLAML default | `types.ts`, `python/train.py`, `python/requirements.txt`, `commands/train.ts` | ✅ DONE |
| 3 | One-hot encoding for nominals + standard scaling | `types.ts`, `encoding.ts`, `commands/train.ts` | ✅ DONE |
| 4 | Fix toy hash encoding | `encoding.ts` | ✅ DONE |
| 5 | Scope schema hash to model's Prisma block | `schema.ts`, `commands/train.ts`, `prediction.ts` | ✅ DONE |
| 6 | Python env pre-flight check | `commands/train.ts` | ✅ DONE |
| 7 | Populate `schemaHash` in artifact at compile time | `commands/train.ts` | ✅ DONE |
| 8 | Remove dead code: `ModelRegistry`, `version` field | `defineModel.ts`, `types.ts`, `index.ts` | ✅ DONE |

---

## Change 1 — Fix Wrong ONNX Runtime Package

**Problem:** `prediction.ts` imports `onnxruntime-web`, the browser/WASM package. In Node.js this runs on the WASM backend — slow, no hardware acceleration, different numeric behaviour than native.

**Fix:**
- `packages/scheml/package.json`: replace `"onnxruntime-web"` dependency with `"onnxruntime-node"`
- `packages/scheml/src/prediction.ts`: change `import * as ort from 'onnxruntime-web'` → `import * as ort from 'onnxruntime-node'`

---

## Change 2 — Make `algorithm` Optional + FLAML Default

**Problem:** `algorithm` is a required field that forces the user to make an ML decision they are not qualified to make. The hardcoded sklearn algorithms are also below industry baseline for tabular data.

**Fix:**

### `packages/scheml/src/types.ts`
- Make `algorithm?: AlgorithmConfig` optional on `ModelDefinition`.
- Remove the `version` field from `AlgorithmConfig` (it was declared but never read by the Python backend). Keep `name` and `hyperparameters` for power users who want manual override.
- The type of `name` stays as `string` (not a union), since the backend now accepts `'automl'` as the implicit default plus legacy `'linear'|'tree'|'forest'|'gbm'` for explicit override.

### `packages/scheml/python/train.py`
- Replace the current `build_model()` switch with a FLAML-first path:
  - If `algorithm` is absent or `'automl'`, run `flaml.AutoML` with `time_budget=60` and `task` derived from `taskType`.
  - If `algorithm` is an explicit sklearn name (`linear`, `tree`, `forest`, `gbm`), fall back to the existing sklearn constructors (kept for power users).
- FLAML's best model is exported to ONNX via `skl2onnx` using the same `export_onnx()` helper.
- FLAML records the best estimator name in the metrics output under a `"bestEstimator"` key so the user can see what was chosen.

### `packages/scheml/python/requirements.txt`
Add:
```
flaml==2.3.0
```

### `packages/scheml/src/commands/train.ts`
- Remove the `algorithm` required-field guard — if absent, pass `algorithm: 'automl'` to the Python dataset JSON.
- Log the `bestEstimator` returned from Python in the spinner success message.

---

## Change 3 — One-Hot Encoding for Nominals + Standard Scaling

**Problem:** Label encoding (0, 1, 2 …) imposes ordinal meaning on nominal categories. This silently breaks linear models and logistic regression. No feature scaling is applied; linear models get degraded results when feature magnitudes differ wildly.

**Fix:**

### `packages/scheml/src/types.ts`
- Add `'onehot'` to `CategoryEncoding.type`.
- Add a `OneHotEncoding` metadata type that carries `categories: string[]` and the resulting `columnNames: string[]` (for bookkeeping in metadata).
- Add `ScalingSpec` interface: `{ strategy: 'standard' | 'minmax' | 'none'; mean?: number; std?: number; min?: number; max?: number }` — computed at train time, stored in metadata, applied at inference.

### `packages/scheml/src/encoding.ts`
- `normalizeScalarValue`: when `encoding.type === 'onehot'`, this function now returns an array of numbers (one per category) rather than a single number. The function signature becomes `normalizeValue(...)` returning `number | number[]` — callers (`normalizeFeatureVector`) flatten the result.
- `normalizeFeatureVector`: update to flatten one-hot arrays into the final vector.
- Add `applyScaling(value: number, spec: ScalingSpec): number`.
- Remove the `hash` encoding branch (or keep only as explicit opt-in). Default category encoding is now `onehot`.

### `packages/scheml/src/commands/train.ts`
- In the per-feature stats loop, change the default encoding for `string` features from `label` to `onehot`.
- After building the dataset, apply standard scaling stats (mean, std) for numeric features when the algorithm is linear. Store scaling specs in the feature schema passed to metadata.
- The Python backend does **not** need to scale — scaling is already applied to the vector before it is passed to Python training.

---

## Change 4 — Fix Toy Hash Encoding

**Problem:** Hash encoding uses `sum of char codes % 1000` — trivially collides (`"ab" === "ba"`), flagged in source as a known issue.

**Fix:** `packages/scheml/src/encoding.ts`
- Replace with FNV-1a 32-bit hash, which is fast, zero-dependency, and collision-resistant enough for this use case.
- FNV-1a is a well-known non-cryptographic hash function: `hash = (hash ^ charCode) * FNV_PRIME` per character.
- Keep `hash` encoding as an explicit opt-in (for high-cardinality categoricals), but the default changes to `onehot` per Change 3.

---

## Change 5 — Scope Schema Hash to Model's Prisma Block

**Problem:** The entire `prisma/schema.prisma` is hashed. Adding an unrelated model (e.g., a new `BlogPost`) causes `SchemaDriftError` at runtime even though the `User` model the prediction depends on is unchanged.

**Fix:** `packages/scheml/src/schema.ts`
- Add `hashPrismaModelSubset(schema: string, modelName: string): string`:
  - Extract only the `model <modelName> { … }` block and any enums it references.
  - Normalize and hash only that subset.
- `packages/scheml/src/commands/train.ts`: use `hashPrismaModelSubset` instead of `hashPrismaSchema` when writing `metadata.prismaSchemaHash`.
- `packages/scheml/src/prediction.ts` (`PredictionSession.load`): use `hashPrismaModelSubset(schema, model.modelName)` instead of `hashPrismaSchema(schema)`.

---

## Change 6 — Python Env Pre-Flight Check

**Problem:** `commands/train.ts` calls `spawnSync` to the Python backend without verifying that Python or any of the required packages are installed. Failure manifests as an opaque subprocess error.

**Fix:** `packages/scheml/src/commands/train.ts`
- Before the training loop, add a `checkPythonEnvironment()` function that:
  1. Checks `python3` (or `python`) is on PATH (`which python3`).
  2. Runs `python3 -c "import flaml, sklearn, skl2onnx, numpy, onnx"` and catches `ModuleNotFoundError`.
  3. On failure, throws a `ConfigurationError` with a clear message: "Required Python packages not found. Run: pip install -r packages/scheml/python/requirements.txt".

---

## Change 7 — Populate `schemaHash` in `ModelDefinition` at Compile Time

**Problem:** `defineModel()` sets `schemaHash: undefined` with a comment "filled at compile time", but `commands/train.ts` never sets it. The field is always `undefined` in the runtime object.

**Fix:** `packages/scheml/src/commands/train.ts`
- After computing `schemaHash` (now via `hashPrismaModelSubset`), set `model.schemaHash = schemaHash` on each model definition before training begins.
- This makes the field accurate and removes the misleading `undefined`.

---

## Change 8 — Remove Dead Code

### `ModelRegistry` (`defineModel.ts`, `index.ts`)
- `ModelRegistry`, `globalModelRegistry`, and `registerModel` are declared and exported but never used in any part of the pipeline. Model discovery uses duck-typing on the config module exports.
- **Remove** the class and the two exports. Remove corresponding re-exports from `index.ts`.

### `AlgorithmConfig.version` (`types.ts`)
- The `version: string` field is declared required but ignored by the Python backend entirely.
- **Remove** the field. If algorithm pinning ever becomes real it should be re-introduced with an actual implementation.

---

## Invariants to Preserve

- `normalizeFeatureVector` public signature must not break existing callers in `prediction.ts`.
- `FeatureSchema` stored in `metadata.json` must remain backward-read-compatible (additive changes only).
- All existing passing tests must continue to pass after the changes.
- `hashPrismaSchema` stays exported and unchanged — only `load()` and `train` switch to the scoped variant. Existing callers of the public API who call `hashPrismaSchema` are unaffected.
