# ScheML Architecture

## Purpose

This document defines the technical boundaries of ScheML.

It explains:
- what the system does
- how build-time and runtime responsibilities are separated
- what guarantees the architecture is trying to uphold
- where the current pressure points are

It does not define roadmap sequencing or business strategy.

## System Model

ScheML is a compiler-first ML workflow for TypeScript + Prisma applications.

The high-level flow is:

```text
defineModel() declarations
        ->
scheml train
        ->
model.onnx + model.metadata.json
        ->
PredictionSession.load()
        ->
PredictionSession.predict()
```

The core architectural boundary is simple:
- training happens at build time
- inference happens at runtime
- artifacts connect the two

## Build-Time Boundary

Build-time work is responsible for:
- loading model definitions
- loading and hashing the Prisma schema
- extracting rows through Prisma
- running feature resolvers on those rows
- encoding features into deterministic vectors
- invoking the Python trainer
- evaluating quality gates
- writing immutable artifacts

The build-time path is entered through `scheml train`.

### Build-Time Inputs

- `scheml.config.ts`
- `prisma/schema.prisma`
- a reachable Prisma-backed dataset
- Python dependencies required by the training backend

### Build-Time Outputs

- `model.onnx`
- `model.metadata.json`

These outputs are intended to be treated as immutable build artifacts.

## Runtime Boundary

Runtime work is responsible for:
- loading artifacts
- validating the current schema hash against the compiled metadata
- extracting features from application entities
- normalizing those features with the compiled contract
- running ONNX inference
- returning prediction results

The runtime path is entered through `PredictionSession`.

Runtime is not responsible for:
- retraining
- mutating artifacts
- experimenting with alternate live models
- discovering new schema meaning dynamically

## Core Invariants

## 1. Training And Inference Are Separate Phases

ScheML is designed around a hard split between compilation and execution.

Training may use Python and external ML libraries.
Runtime should consume the compiled result, not recreate training behavior ad hoc.

## 2. Artifacts Are The Contract

The ONNX file alone is not enough.

`model.metadata.json` carries the semantic contract required for safe inference:
- model identity
- task type
- feature order
- encoding rules
- imputation rules
- schema hash
- training metadata

If artifacts and runtime expectations diverge, inference should fail loudly.

## 3. Schema Safety Is A First-Class Constraint

Models are bound to a normalized Prisma schema hash.

The system should reject predictions when the runtime schema does not match the compiled schema contract.

This is one of the main protections against silent training-serving skew.

## 4. Determinism Matters More Than Flexibility

The architecture is optimized for:
- explicit inputs
- explicit artifacts
- reviewable behavior

It is not optimized for:
- live adaptation
- dynamic runtime model routing
- continuously mutating model state

## 5. The Feature Path Must Stay Coherent

Feature extraction at training time and feature normalization at runtime must describe the same contract.

Any gap here is a correctness risk.

## Artifact Model

Each trained model produces two files:

### `model.onnx`

The executable prediction artifact.

### `model.metadata.json`

The compatibility and semantics artifact.

Metadata currently includes the information needed for runtime validation and feature normalization, including:
- package version
- metadata schema version
- model name
- task type
- algorithm configuration
- feature schema
- encoding rules
- imputation rules
- Prisma schema hash
- optional training metrics and dataset metadata
- compilation timestamp

## Compile-Time Versus Runtime Responsibilities

### Compile-Time

- resolve model definitions
- validate configuration shape
- materialize and encode training data
- train the model
- enforce quality gates
- emit artifacts

### Runtime

- load artifacts
- validate schema compatibility
- evaluate resolvers on application entities
- normalize feature vectors
- run predictions

### Out Of Runtime Scope

- training orchestration beyond artifact loading
- feedback loops
- online learning
- traffic splitting
- rollout control planes

## Current Technical Pressure Points

These are architecture pressure points, not promises:

### 1. Preprocessing Contract Correctness

The product depends on training-time preprocessing and runtime normalization staying aligned.

Any mismatch here weakens the compile-first guarantee.

### 2. Auditability Depth

The current artifact contract is useful, but the architecture can support richer provenance and inspection metadata.

### 3. Multi-Model Growth

The current system supports the core single-model path cleanly.
If multi-model workflows become central, artifact organization and API boundaries will need to stay explicit.

### 4. Source Specificity

ScheML is currently built around Prisma.
Any future generalization would need to preserve the same level of schema clarity and build-time contract discipline.

## Architectural Limits

ScheML intentionally does not optimize for:
- online learning
- dynamic experimentation platforms
- runtime model control planes
- opaque hosted inference as the primary product shape

Those directions introduce state and operational complexity that conflict with the current architecture.

## Repo Surface

The main implementation lives in:

```text
packages/scheml/src
```

The main build and runtime surfaces are:
- `src/commands/train.ts`
- `src/commands/check.ts`
- `src/prediction.ts`
- `src/schema.ts`
- `src/encoding.ts`
- `src/types.ts`

## Reading Order

If you are new to the repo, use this order:

1. `README.md`
2. `ROADMAP.md`
3. `docs/ARCHITECTURE.md`
4. `docs/GUIDE.md`
5. `docs/API.md`
