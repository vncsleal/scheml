# ScheML Feature Surface

This document describes the current feature surface of ScheML.

For future direction and sequencing, see [ROADMAP.md](../ROADMAP.md).

## Model Definition

ScheML exposes `defineModel<TModel>()` for declarative model definitions.

A model definition includes:
- model name
- target Prisma model name
- output field and task type
- named feature resolvers
- algorithm configuration
- optional quality gates

## Schema Binding

ScheML binds trained artifacts to a normalized Prisma schema hash.

Current behavior:
- schema is normalized before hashing
- the hash is stored in metadata
- runtime loading validates the current schema against the compiled contract

## Training

`scheml train` drives the build-time flow:
- load model definitions
- load Prisma schema
- extract rows through Prisma
- materialize features
- invoke the Python backend
- evaluate quality gates
- emit ONNX and metadata artifacts

## Schema-Only Validation

`scheml check` validates the schema contract without training.

It is intended for fast feedback in CI or local validation before running the full training path.

## Feature Resolution And Normalization

Current supported scalar outputs from feature resolvers:
- `number`
- `boolean`
- `string`
- `Date`
- `null` with an explicit imputation rule

Current normalization behavior:
- booleans become `0` or `1`
- strings use categorical encoding
- dates are converted to timestamps
- null handling depends on declared imputation

## Feature Analysis

ScheML includes a feature-analysis module, but the AST analysis path is currently conservative and limited.

Practical consequence:
- some guarantees are enforced by runtime behavior and contract validation rather than deep static extraction

## Runtime Prediction

`PredictionSession` is the runtime entrypoint.

Current runtime responsibilities:
- load artifacts
- validate schema compatibility
- normalize features against metadata
- run single or batch predictions

Batch prediction behavior is atomic:
- validation happens before inference
- failures abort the batch
- no partial results are returned

## Artifacts

Each model produces two artifacts:
- `model.onnx`
- `model.metadata.json`

These artifacts are intended to be committed and treated as immutable outputs of the training step.

## Error Model

ScheML uses typed errors to fail loudly when contracts break.

Key failure categories include:
- schema drift
- invalid model definition
- feature extraction failure
- unseen categories
- encoding failures
- artifact failures
- quality gate failures

## Constraints

ScheML currently prioritizes:
- determinism
- explicit contracts
- schema safety
- in-process inference

ScheML does not currently aim to provide:
- online learning
- runtime model orchestration
- broad platform behavior
