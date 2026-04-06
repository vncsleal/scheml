# ScheML Feature Surface

This document describes the current feature surface of ScheML.

For future direction and sequencing, see [ROADMAP.md](../ROADMAP.md).

## Trait Definition

ScheML exposes `defineTrait()` for declarative intelligence trait definitions.

A trait definition includes:

- trait name and type: `predictive`, `anomaly`, `similarity`, `temporal`, `generative`
- target entity: string entity name, Drizzle table, or other adapter-specific runtime reference
- feature definitions: direct field names or resolver-backed extraction paths depending on trait type
- task type and output field for predictive and temporal traits
- optional quality gates
- optional downstream trait references

## Explicit Adapters

ScheML now requires explicit adapter selection through `defineConfig({ adapter })`, `PredictionSession.loadTrait({ adapter })`, or adapter factory instances.

Current built-in adapters:

- Prisma
- Drizzle
- TypeORM
- Zod

Adapter inference from schema paths is not part of the current feature surface.

## Schema Binding

ScheML binds artifacts to an adapter-normalized entity hash stored as `schemaHash`.

Current behavior:

- the adapter reads the source schema into a normalized schema graph
- the relevant entity hash is stored in artifact metadata
- runtime loading recomputes the current hash through the same adapter contract
- drift causes a hard failure rather than a soft fallback

Text-schema helpers such as `hashSchemaText()` and `hashSchemaEntitySubset()` remain available, but the primary compatibility contract is adapter-neutral.

## Training

`scheml train` drives the build-time flow:

- load config and traits
- resolve the explicit adapter
- read the schema and compute artifact hashes
- extract rows through the adapter when needed
- materialize features
- fit feature encodings, imputations, and scaling rules
- invoke the Python backend when needed
- evaluate quality gates
- emit artifacts and history records

## Schema-Only Validation

`scheml check` validates the current schema contract against existing artifacts without retraining.

It is intended for fast CI and local feedback.

## Feature Resolution And Normalization

Supported scalar outputs from feature resolvers:

- `number`
- `boolean`
- `string`
- `Date`
- `null` or `undefined` when an imputation rule exists

Current normalization behavior:

- booleans become `0` or `1`
- strings use label, hash, or one-hot categorical encoding depending on the contract
- dates are converted to timestamps
- null handling depends on the compiled imputation rule
- numeric features may be standardized with training-time statistics

## Feature Analysis

ScheML includes resolver analysis utilities such as `analyzeFeatureResolver()` and `validateHydration()`.

The analysis path is intentionally conservative. Some guarantees are enforced by runtime validation and contract matching instead of deep compile-time extraction.

## Runtime Prediction

`PredictionSession` is the runtime entrypoint.

Current runtime capabilities:

- predictive inference
- temporal inference
- anomaly scoring
- similarity nearest-neighbour retrieval

Runtime responsibilities:

- load artifacts
- validate schema compatibility
- normalize feature inputs against metadata
- run single or batch predictions
- run similarity lookup for similarity traits

Batch prediction behavior is atomic:

- validation happens before inference
- failures abort the batch
- no partial results are returned

## Client Extension

`extendClient()` exposes trait fields directly on adapter clients when the adapter implements a query interceptor.

Current interceptor-backed adapters:

- Prisma
- TypeORM

Current modes:

- `materialized`
- `live`

Live mode requires the trait artifacts to exist. Missing live metadata is treated as an error, not a fallback condition.

## Artifacts

Each trait always produces metadata and may also produce a runtime artifact:

- predictive: metadata + ONNX
- temporal: metadata + ONNX
- anomaly: metadata with embedded model state and normalization stats
- similarity: metadata + NPY or FAISS index
- generative: metadata only

Artifacts are intended to be committed and treated as immutable outputs of the build step.

## Observability And History

ScheML includes artifact inspection and history commands:

- `status`
- `inspect`
- `diff`
- `audit`

These commands work from emitted metadata and history records rather than retraining state.

## Error Model

ScheML uses typed errors to fail loudly when contracts break.

Key failure categories include:

- schema drift
- invalid model definition
- feature extraction failure
- hydration mismatch
- unseen categories
- encoding failures
- artifact failures
- quality gate failures
- runtime inference failures

## Constraints

ScheML currently prioritizes:

- determinism
- explicit contracts
- explicit adapters
- schema safety
- in-process inference

ScheML does not aim to provide:

- online learning
- runtime adapter guessing
- hybrid fallback serving modes
- broad hosted model orchestration
