# ONNX Runtime Parity Assessment

**Status:** Open — architectural decision required before V1.0  
**Severity:** Critical — undermines the compile-first determinism guarantee  
**Affects:** `PredictionSession`, `predictBatch`, all quality gate results

---

## The Problem

PrisML's core guarantee is compile-first determinism: what is validated at train time is what runs in production. The quality gate system (`qualityGates: [{ metric: 'rmse', threshold: 300, comparison: 'lte' }]`) is the operational enforcement of that guarantee — training refuses to emit an artifact if the model doesn't meet specified thresholds.

That guarantee is only meaningful if the runtime used to evaluate quality gates is the same runtime used in production inference. Currently it is not.

**Training:** Python's `onnxruntime` package — the native C++ ORT library, compiled for the host platform with AVX/AVX-512 support where available.

**Inference:** `onnxruntime-web` — ORT compiled to WebAssembly, currently pinned at `^1.16.3` in `package.json`.

These are different execution backends. They share the ONNX spec, but they do not share the computation path.

---

## How Divergence Occurs

### Float32 arithmetic is not perfectly portable

IEEE 754 defines float32 semantics but leaves room for implementation variation:

- **Fused Multiply-Add (FMA):** Native ORT on x86-64 uses AVX-512 with FMA instructions, which compute `a × b + c` in a single operation with one rounding. WASM SIMD does not have an FMA instruction — it computes a separate multiply and a separate add, introducing two rounding operations instead of one. The same input produces a slightly different output.

- **Subnormal (denormal) handling:** x86-64 CPUs default to DAZ (Denormals Are Zero) + FTZ (Flush To Zero) in vectorized code, treating near-zero floats as exactly zero for performance. WASM's float semantics are defined by the host JavaScript engine, which may or may not apply the same flush. The runtimes can disagree on values in the `~1e-38` range.

- **Reduction order:** Operations like softmax and sum reductions over feature vectors are order-dependent in float32. The order is implementation-defined at the executor level, not the ONNX graph level.

### By algorithm — practical severity

| Algorithm | ONNX operator | Divergence risk | Why |
|---|---|---|---|
| `forest` | `TreeEnsembleRegressor` | **Low (but unverified)** | Branch decisions are threshold comparisons — no arithmetic. Leaf value accumulation is float32 addition in fixed graph order. Numerically benign unless leaves aggregate hundreds of trees with extreme values. |
| `linear` | `LinearRegressor` | **Medium** | Dot product `w·x + b` over feature vector. FMA divergence scales with feature count × weight magnitude. |
| `gbm` | `TreeEnsembleRegressor` (with softmax/sigmoid post-op) | **Medium-High** | Tree ensemble output passes through softmax or sigmoid normalisation — both are non-linear operators with FMA sensitivity at the boundaries. |
| Future: anomaly, ranking | Various | **Unknown** | Not yet implemented; parity bounds not established. |

### The quality gate gap — the critical consequence

`prisml train` evaluates RMSE (or other metrics) using Python `onnxruntime`. The artifact is stamped "passes gate" in `ModelMetadata`. But the gate was evaluated against a runtime that is never used in production.

A model at the threshold boundary — RMSE = 299.8, gate is ≤ 300 — may produce predictions that average to RMSE = 300.3 under `onnxruntime-web` WASM. The artifact passes build time validation yet fails the condition it was validated against, on every production inference call. The audit trail (if implemented per V1 roadmap) records `prismaSchemaHash` and `artifactHash` but cannot record "this artifact was validated against a different execution backend than production."

For a library whose differentiation is audit-first positioning in regulated industries, this is not a caveat to document — it's a structural contradiction.

---

## Current Code State

`prediction.ts` line 8:

```ts
import * as ort from 'onnxruntime-web';
```

This is the only ONNX import in the entire package. There is no environment detection, no runtime selection, no fallback path. Every `PredictionSession` call — regardless of whether it runs in Node.js, a browser, or an edge runtime — goes through `onnxruntime-web`.

### Secondary issue: `predictBatch` is not actually batched

`predictBatch` deserves separate attention. Despite accepting `entities[]`, it runs inference in a sequential `for` loop — one `session.run()` call per entity:

```ts
// prediction.ts — Phase 2 of predictBatch
for (let i = 0; i < featureVectors.length; i++) {
  const inputTensor = new ort.Tensor('float32', Float32Array.from(vector), [1, vector.length]);
  const onnxResults = await session.run({ [inputName]: inputTensor });
  // ...
}
```

The tensor shape is `[1, featureCount]` — a single row. A genuine batched execution would pass a `[N, featureCount]` tensor and get `[N, 1]` back in one `session.run()` call, which avoids the per-call overhead of WASM session dispatch. This is not a correctness issue (results are identical), but the primary reason to call `predictBatch` over `predict` in a loop is efficiency — and that efficiency does not currently exist.

This is a separate issue from runtime parity but worth addressing in the same pass since both touch `prediction.ts` and both require `onnxruntime-node` to be introduced as a dependency.

---

## The Fix

### Primary: `onnxruntime-node` as the default runtime

`onnxruntime-node` is the official Node.js binding for ORT. It uses the same C++ native library as Python's `onnxruntime`. They share:

- The same operator implementations
- The same floating-point execution paths (AVX/AVX-512 on x86-64)
- The same FMA behavior
- The same subnormal handling

This closes the parity gap entirely for all current deployment targets — `PredictionSession` is always called from Node.js (Next.js API routes, Express, standalone scripts).

```ts
// After fix — prediction.ts
import * as ort from 'onnxruntime-node'; // matches Python training runtime
```

Quality gates evaluated in Python become meaningful: what passes in Python will produce equivalent arithmetic in Node.js production.

### Secondary: `onnxruntime-web` as an explicit opt-in

`onnxruntime-web` remains the correct runtime for:
- Browser-side inference (WASM)
- Cloudflare Workers / Deno Deploy (no native Node.js bindings available)
- Any edge runtime without native addon support

The runtime selection should be opt-in and explicit, not the default:

```ts
// Option A: separate entrypoints
import { PredictionSession } from '@vncsleal/prisml';         // onnxruntime-node (default)
import { PredictionSession } from '@vncsleal/prisml/edge';    // onnxruntime-web (opt-in)

// Option B: env-based selection at load time
const session = new PredictionSession({ runtime: 'web' }); // explicit override
```

Option A (separate entrypoints) is structurally cleaner — it makes the runtime choice a bundler/import decision rather than a constructor argument, which is idiomatic for packages that need different dependency trees per environment.

The edge entrypoint should include explicit documentation that quality gate guarantees apply to the `onnxruntime-node` path only, and that floating-point results may differ by `~1e-5` relative error on the web path for non-tree-ensemble models.

### Tertiary: true batch execution in `predictBatch`

With `onnxruntime-node`, the tensor API supports proper `[N, featureCount]` batched inference. The fix for `predictBatch` is to:

1. Build a single flat `Float32Array` from all feature vectors (already computed in Phase 1)
2. Create one `Tensor('float32', data, [N, featureCount])` 
3. Call `session.run()` once
4. Split the `[N, 1]` (regression) or `[N, C]` (classification) output tensor back into per-entity results

This is a modest implementation change but the performance benefit for batch jobs (nightly re-scoring, weekly reports) is significant — `onnxruntime-node` native batched inference avoids O(N) WASM dispatch overhead.

---

## Migration Impact

### Package changes

```json
// package.json — before
"onnxruntime-web": "^1.16.3"

// package.json — after
"onnxruntime-node": "^1.21.0",       // default runtime (matches Python training)
"onnxruntime-web": "^1.21.0"         // optional edge runtime (separate entrypoint)
```

Version alignment matters: Python's `onnxruntime` and `onnxruntime-node` should be pinned to the same minor version to guarantee identical operator implementations. As of this writing the latest stable is 1.21.x for both.

### Test changes

`prediction.test.ts` currently runs fine against `onnxruntime-web` in a Node.js Vitest environment because WASM runs in Node.js. After the switch to `onnxruntime-node`, tests run against the native binding — this is strictly better but requires `onnxruntime-node` to resolve in the test environment. No behavioral changes to tests are expected.

`prisml-test` integration tests (`pipeline.test.ts`, `cli.test.ts`) run against the full stack. These should continue to pass unchanged — `onnxruntime-node` outputs numerically equivalent results to `onnxruntime-web` for `TreeEnsembleRegressor` (forest model used in prisml-test). The `KNOWN_SCHEMA_HASH` constant is unaffected.

### Artifacts

No artifact changes. ONNX files are runtime-agnostic binary format. Existing `.prisml/*.onnx` files work with both runtimes.

---

## Why This Is V1, Not V2

The audit & provenance section is the centerpiece of V1 differentiation. The planned V1 deliverables include:

- Prediction receipts with `{ schemaHash, artifactHash, timestamp }`
- Training provenance (query shape, row count, seed)
- `prisml inspect` showing training metrics

All three are only meaningful if the runtime that produced the metrics during training is the same runtime used in production. Without parity, the `artifactHash` proves the binary matches, but says nothing about whether the computation in that binary reproduces what was validated.

Shipping the audit system on mismatched runtimes would be misleading, not merely imprecise — especially for the regulated-industry use case (financial model risk management, healthcare audit trails) that motivates the audit section in the first place.

**Switching to `onnxruntime-node` is a prerequisite for V1 audit features, not a nice-to-have.**

---

## Action Items

| Priority | Item | Owner |
|---|---|---|
| **V1 — blocker** | Replace `import * as ort from 'onnxruntime-web'` with `onnxruntime-node` as default | `prediction.ts` |
| **V1 — blocker** | Pin `onnxruntime-node` version to match Python `onnxruntime` version | `package.json` + `train.py` |
| **V1** | Create `/edge` entrypoint re-exporting `PredictionSession` backed by `onnxruntime-web` | `src/edge.ts` + `package.json#exports` |
| **V1** | Document edge runtime caveat in `/edge` entrypoint JSDoc and README | docs |
| **V1** | Fix `predictBatch` to pass `[N, featureCount]` tensor in a single `session.run()` | `prediction.ts` |
| **V1** | Add parity test: run same input through both runtimes, assert results within tolerance | `prediction.test.ts` |
| **V2** | Extend parity test to cover `linear` and `gbm` task types when they ship | `prediction.test.ts` |
