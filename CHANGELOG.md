# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-08

Initial public release of `@vncsleal/scheml`.

ScheML is a new package derived from [`@vncsleal/prisml`](https://github.com/vncsleal/prisml). It retains the compiler-first ML philosophy and ONNX artifact contract from prisml and extends them to a five-trait type system that is adapter-neutral from the ground up.

### Added

- **Five trait types** via `defineTrait(entity, config)`: `predictive`, `anomaly`, `similarity`, `temporal`, and `generative`. Each trait type compiles to a versioned build artifact with an explicit runtime contract.
- **`defineConfig(config)`**: declares the adapter, schema source, and trait list for a project. Validated at config-load time before any training begins.
- **Adapter system**: Prisma (primary), Drizzle, TypeORM, and Zod schema readers. Prisma and TypeORM support full `extendClient()` interception; Drizzle and Zod support schema reading only.
- **`extendClient(client, config, options?)`**: extends Prisma/TypeORM clients in `materialized` or `live` mode. In `materialized` mode the trait name is the database column contract.
- **`createPredictionSession(config)` / `PredictionSession`**: low-level runtime entrypoint for loading artifacts and running inference in-process — no serialisation, no network hop.
- **Trait graph validation**: `resolveTraitGraph()` validates dependency order, rejects duplicate names and cycles, and trains in topological order so prerequisite traits always precede dependents.
- **Schema drift detection**: `checkArtifactDrift()` compares the stored schema hash in artifact metadata against the current entity schema and fails loud on mismatch.
- **`scheml train`**: compiles traits to `.onnx` + `.metadata.json` artifacts via a Python backend (FLAML AutoML default, 60-second budget). Trains in dependency-topological order. `--trait <name>` includes the dependency closure automatically.
- **Python training backend** (`python/train.py`, `python/requirements.txt`): scikit-learn, FLAML, skl2onnx, onnx, faiss-cpu. Included in the published tarball under `python/`.
- **Quality gates**: `scheml train` exits non-zero if any declared `qualityGates` metric threshold fails. Enforced for predictive and temporal traits; configuration error for unsupported trait types.
- **Train-derived preprocessing contract**: feature encodings, imputations, and scaling rules fit from the training split; stored in artifact metadata; applied identically at inference. No test-set leakage.
- **Full CLI**: `scheml train`, `scheml check`, `scheml status`, `scheml inspect`, `scheml diff`, `scheml audit`, `scheml migrate`, `scheml materialize`, `scheml generate`, `scheml history`, `scheml init`.
- **History & feedback**: append-only JSONL audit trail for training runs and drift events (`history/`); accuracy-decay detection from ground-truth observations (`feedback/`).
- **`TTLCache`**: in-process prediction session cache with TTL eviction.
- **88 public exports** with full TypeScript declaration maps and source maps.


[0.1.0]: https://github.com/vncsleal/scheml/releases/tag/v0.1.0
