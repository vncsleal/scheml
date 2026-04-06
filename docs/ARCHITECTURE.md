# ScheML Architecture

## Purpose

This document defines the technical boundaries of ScheML.

It explains:

- what the system does
- how build-time and runtime responsibilities are separated
- which guarantees the architecture is intended to uphold
- which implementation constraints are deliberate rather than accidental

It does not define roadmap sequencing.

## System Model

ScheML is a compiler-first ML workflow for TypeScript applications with explicit schema adapters.

The high-level flow is:

```text
defineTrait() declarations
        ->
scheml train
        ->
trait artifacts (.metadata.json + optional runtime binary/index)
        ->
PredictionSession.loadTrait()
        ->
PredictionSession.predict() / predictBatch() / predictSimilarity()
```

The core architectural split is:

- training happens at build time
- inference happens at runtime
- artifacts are the only contract between them

## Adapter Model

ScheML is no longer modeled as a Prisma-specialized runtime with adapter inference layered on top. The architecture assumes explicit adapter selection.

An adapter is responsible for some or all of the following:

- reading a schema into a normalized `SchemaGraph`
- hashing entities for artifact compatibility checks
- extracting rows for training and materialization
- intercepting client queries for trait field access at runtime

Built-in adapter roles today:

- Prisma: schema reader, extractor, runtime interceptor
- Drizzle: schema reader, optional extractor, no production query interceptor contract yet
- TypeORM: schema reader, extractor, runtime interceptor
- Zod: schema reader only

## Build-Time Boundary

Build-time work is responsible for:

- loading `scheml.config.ts`
- resolving the explicit adapter
- reading the source schema
- computing the entity-scoped schema hash used by the artifact contract
- extracting rows through the adapter when training requires database access
- evaluating feature resolvers on extracted rows
- fitting the feature contract
- invoking the Python trainer when required
- evaluating quality gates
- writing immutable artifacts and history records

The build-time path is entered through `scheml train`.

### Build-Time Inputs

- `scheml.config.ts`
- an explicit adapter configuration
- a schema source compatible with that adapter
- a reachable dataset for training-capable adapters
- Python dependencies required by the training backend

### Build-Time Outputs

- `<traitName>.metadata.json`
- trait-specific runtime artifacts such as `.onnx`, `.embeddings.npy`, `.faiss`, or embedded metadata-only payloads

These outputs are intended to be treated as immutable build artifacts.

## Runtime Boundary

Runtime work is responsible for:

- loading artifacts
- reading the current schema through the explicit adapter
- recomputing the current entity hash
- rejecting runtime execution when the current schema does not match the artifact contract
- extracting feature values from application entities
- normalizing those features with the compiled contract
- running inference or similarity lookup
- returning prediction results

The runtime path is entered through `PredictionSession` or `extendClient()`.

Runtime is not responsible for:

- retraining
- mutating artifacts
- silently degrading around missing artifacts
- guessing the adapter from a schema path
- treating legacy fallback behavior as part of the contract

## Core Invariants

## 1. Training And Inference Are Separate Phases

ScheML is built around a hard split between compilation and execution.

Training may use Python and ML libraries.
Runtime consumes the compiled result and must not reconstruct training decisions dynamically.

## 2. Artifacts Are The Contract

The runtime contract is carried by artifact metadata, plus the runtime artifact where applicable.

Metadata carries the semantic contract required for safe execution:

- trait identity and type
- entity identity
- feature order and contract shape
- encoding rules
- imputation rules
- scaling or normalization data
- schema hash
- artifact format
- optional metrics and provenance

If artifacts and runtime expectations diverge, ScheML should fail loudly.

## 3. Schema Safety Is Adapter-Neutral

Artifacts are bound to an adapter-normalized entity hash, stored as `schemaHash`.

That hash is no longer described as a Prisma-only concept in the architecture. Text-schema helpers still exist, but the primary runtime contract is the adapter-neutral schema graph and entity hash.

This is the main defense against silent training-serving skew.

## 4. Explicitness Beats Heuristics

The architecture favors:

- explicit adapters
- explicit schema paths
- explicit artifacts
- reviewable behavior

It is intentionally hostile to silent fallback behavior because hidden fallback paths weaken correctness guarantees.

## 5. The Feature Path Must Stay Coherent

Feature extraction at training time and runtime normalization must describe the same contract.

Any mismatch here is a correctness failure, not just a degraded experience.

## Artifact Model

Each trait emits a metadata file and, when applicable, a runtime artifact:

- predictive: metadata + ONNX
- temporal: metadata + ONNX
- anomaly: metadata with normalization and model payload
- similarity: metadata + embedding or index artifact
- generative: metadata only

The artifact contract is immutable once emitted.

## Compile-Time Versus Runtime Responsibilities

### Compile-Time

- resolve trait definitions
- validate configuration shape
- validate adapter compatibility
- materialize and encode training data
- train the model or build the index
- enforce quality gates
- emit artifacts

### Runtime

- load trait artifacts
- validate schema compatibility
- evaluate resolvers on application entities
- normalize feature vectors
- run inference or nearest-neighbour lookup
- expose trait fields through adapter interceptors when supported

### Out Of Runtime Scope

- online learning
- traffic splitting
- rollout control planes
- hosted control-plane inference orchestration

## Runtime Surfaces

### `PredictionSession`

`PredictionSession` is the low-level runtime API. It supports:

- predictive inference
- temporal inference
- anomaly scoring
- similarity lookup

Generative traits compile into metadata describing prompt/output structure, but they are not ONNX-backed runtime sessions.

### `extendClient()`

`extendClient()` is the higher-level runtime API for adapters that implement query interception.

Supported modes are:

- `materialized`
- `live`

`hybrid` is intentionally absent from the architecture because it weakens the contract by hiding which source of truth is actually serving the trait.

In live mode, the runtime must fail loudly when required live artifacts are missing.

## Architectural Limits

ScheML intentionally does not optimize for:

- online learning
- dynamic experimentation platforms
- runtime model routing layers
- mutable artifact state
- implicit adapter discovery

These directions add state and ambiguity that conflict with the current architecture.

## Repo Surface

The main implementation lives in:

```text
packages/scheml/src
```

Important surfaces:

- `src/commands/train.ts`
- `src/commands/check.ts`
- `src/runtime.ts`
- `src/prediction.ts`
- `src/schema.ts`
- `src/schemaHash.ts`
- `src/adapterResolution.ts`
- `src/adapters/*`

## Reading Order

If you are new to the repo, use this order:

1. `packages/scheml/README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/GUIDE.md`
4. `docs/API.md`
5. `SCHEML_IMPLEMENTATION_PLAN.md`
