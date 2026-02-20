# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [0.1.0] - 2026-02-04

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

[0.1.0]: https://github.com/prisml/prisml/releases/tag/v0.1.0
