# Changelog

All notable changes to PrisML will be documented in this file. This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-01-21

### Changed (Architectural Refactor)
- **Runtime/Compiler Isolation**: Restructured codebase into strict `src/runtime`, `src/compiler`, and `src/core` domains.
  - Root export is now **Runtime-Only** to prevent application bloat.
  - CLI and heavier dependencies are strictly isolated from the production runtime.
- **Directory Restructuring**:
  - Moved Python assets to `assets/python/trainer.py` for better bundling.
  - Organized core logic into `src/core` for shared types and utilities.
  - Organized runtime engines into `src/runtime/engine`.
- **Package Distribution**:
  - Full support for scoped package `@vncsleal/prisml`.
  - Updated `package.json` with strict `exports` map for public API enforcement.
- **Build System**:
  - Switched to `tsup` for high-performance dual-format (CJS/ESM) bundling.
  - Implemented composite TypeScript projects with isolated configurations.
- **Improved Type Safety**:
  - Created specialized TSConfigs for Runtime, Compiler, Tests, and Examples.
  - Resolved several deep-import issues in example code.

### Added
- **Batch Predictions**: Promoted `withMLMany()` to stable feature status.
- **Asset Resolution**: Secure, relative path resolution for Python assets within the npm package.
- **Migration Guide**: Added `docs/MIGRATION.md` for upgrading from v1.0.

## [1.0.0] - 2025-01-10

### Added

#### Core Features (Tier 1)
- **defineModel()** — TypeScript-first API for declaring ML models with Prisma
  - Automatic data extraction from Prisma client
  - Type-safe feature resolvers with `.select()` support
  - Trained ONNX model storage and versioning
  - Full TypeScript & JSDoc documentation

- **prisml()** — Prisma extension for seamless model integration
  - `findMany({ ml: { model, threshold } })` for batch predictions
  - `create()` with automatic feature computation
  - `update()` with prediction caching
  - Works with existing Prisma queries (no migration needed)

- **@prisma/client integration**
  - Type-safe feature access via `model.$resolve(record)`
  - Automatic SQL query optimization for feature extraction
  - Transparent error handling and fallbacks

#### Developer Experience (Tier 2)
- **Model Training**
  - Docker-based trainer (requires Python 3.11, scikit-learn, XGBoost)
  - CLI: `prisml train --config config.json`
  - Support for CSV input and validation set splitting
  - Automatic ONNX conversion (skl2onnx)
  - Minimum accuracy threshold enforcement

- **Error Handling & Validation**
  - Comprehensive TypeScript error types
  - Runtime validation for model input/output
  - Helpful error messages for misconfigured models
  - Graceful fallback when ONNX runtime unavailable

- **Testing & Documentation**
  - 57 comprehensive unit tests (6 test suites)
  - E2E testing examples with Docker Compose
  - 4 runnable examples:
    - Next.js with Prisma ORM (bacon/)
    - Churn prediction example
    - Fraud detection example
    - Batch prediction example
  - Troubleshooting guide for common platform issues

#### Advanced Features (Tier 3)
- **Batch Predictions**
  - `withML()` for single record predictions
  - `withMLMany()` for batch predictions with optimized database queries
  - Configurable batch size for performance tuning
  - Returns predictions alongside original data

- **Model Versioning**
  - Multiple model versions supported in single `defineModel()`
  - `activeVersion` property to switch between versions
  - Migration pattern for rolling out new models
  - Training history and performance comparison

- **A/B Testing**
  - `testingVersion` property for canary deployments
  - Percentage-based traffic splitting (`testingPercent`)
  - Metrics collection for variant comparison
  - Automatic rollback to stable version

- **Prediction Confidence & Thresholds**
  - Confidence scores for each prediction
  - Customizable thresholds per model
  - Fallback values when confidence is low
  - Uncertainty quantification for decision-making

#### Production Readiness
- **Package Distribution**
  - Published to npm as `@vncsleal/prisml` (v1.0.0)
  - Tarball size: 32.6 kB, 62 files
  - Included: TypeScript definitions, source maps, README, examples
  - Prebuilt artifacts for Node.js 18+

- **Docker Distribution**
  - Multi-architecture trainer image: `vncsleal/prisml-trainer:1.0.0`
  - Platforms: linux/amd64 (Intel/AMD), linux/arm64 (Apple Silicon, ARM servers)
  - Tags: `latest` (current), version tags for pinning
  - Verification: Docker image tested on both architectures

- **Platform Compatibility**
  - **Node.js**: 18.x (TESTED), 20.x (TESTED), 22.x (PARTIAL)
  - **Operating Systems**: macOS Intel/ARM (TESTED), Ubuntu (TESTED), Debian (WORKS), Windows (PARTIAL — DLL issues), Alpine (NOT SUPPORTED — glibc incompatibility)
  - **Cloud Platforms**: Vercel (PARTIAL — cold start 3-5s), AWS Lambda (PARTIAL — timeout/memory concerns), Railway (WORKS), Render (WORKS), Cloudflare (NOT SUPPORTED)
  - **Databases**: PostgreSQL (TESTED), Neon (TESTED), Supabase (TESTED), PlanetScale (WORKS), SQLite (WORKS), CockroachDB (PARTIAL)
  - **ONNX Runtime**: Native (prebuilt, <10ms latency), WebAssembly fallback (50-200ms for edge environments)
  - Full compatibility matrix in `docs/PLATFORM_COMPATIBILITY.md`

- **Continuous Integration**
  - GitHub Actions workflow (test.yml)
  - Matrix testing: Node 18.x and 20.x on Ubuntu
  - Automatic linting, building, testing, and packing on push/PR
  - Lint failures do not block CI (advisory only)

- **Security Policy**
  - Vulnerability reporting: security@iamvini.co
  - Security best practices documented in SECURITY.md
  - Known limitations: model integrity signing, training data access, model input validation
  - Not suitable for safety-critical applications

### Documentation
- **README.md** — Quick start, installation, basic usage
- **docs/PRD.md** — Complete feature specification and timeline
- **docs/PLATFORM_COMPATIBILITY.md** — Comprehensive support matrix (Node versions, OS, cloud platforms, databases, ONNX runtime, known issues, deployment tiers)
- **docs/TROUBLESHOOTING.md** — Common issues and solutions
- **docs/API.md** — TypeScript API reference
- **SECURITY.md** — Vulnerability reporting and security best practices
- **CHANGELOG.md** (this file) — Version history

### Breaking Changes
None (initial release).

### Known Issues
1. **Windows**: Building ONNX Runtime requires Visual C++ Build Tools. Workaround: Use WSL2 or Docker.
2. **Alpine Linux**: glibc incompatibility with Node.js prebuilt binaries. Workaround: Use Docker image or Node.js binary from Alpine repository.
3. **Serverless (Vercel, AWS Lambda)**: Cold start latency 3-5s due to large ONNX runtime artifacts. Mitigation: Use HTTP caching or warm up with periodic requests.
4. **Large Models**: Models >50 MB may exceed memory limits in serverless. Mitigation: Quantize ONNX model or split into multiple smaller models.

### Compatibility Matrix

| Component | Support Level | Notes |
|-----------|---------------|-------|
| Node.js 18.x | ✅ TESTED | Primary target |
| Node.js 20.x | ✅ TESTED | Recommended for new projects |
| Node.js 22.x | ⚠️ PARTIAL | Works but not officially tested |
| Node.js <18 | ❌ UNSUPPORTED | Requires upgrade |
| macOS (Intel) | ✅ TESTED | Full support |
| macOS (ARM/M1+) | ✅ TESTED | Full support |
| Ubuntu 20.04+ | ✅ TESTED | Full support |
| Windows 10/11 | ⚠️ PARTIAL | Use WSL2 or Docker |
| Alpine Linux | ❌ UNSUPPORTED | Use Docker image |
| PostgreSQL | ✅ TESTED | Production grade |
| MySQL | ⚠️ WORKS | Supported but not extensively tested |
| SQLite | ⚠️ WORKS | Development only |
| Vercel | ⚠️ PARTIAL | Cold start latency ~3-5s |
| AWS Lambda | ⚠️ PARTIAL | Time/memory constraints |
| Railway | ✅ WORKS | Full support |
| Cloudflare | ❌ UNSUPPORTED | No native binary support |

### Performance Benchmarks

- **ONNX Inference** (Linux, Node 20): <10ms for typical models
- **Feature Extraction**: 50-200ms depending on database queries (network dependent)
- **Model Training** (Docker): 30-120s for 10K-100K records (algorithm & data dependent)
- **Cold Start** (Vercel): 3-5 seconds
- **Batch Predictions** (100 records): 50-500ms depending on batch size

### Migration Path
If upgrading from experimental/beta versions:
1. Backup existing ONNX model files
2. Regenerate models using v1.0.0 trainer
3. Update `defineModel()` calls if using previous alpha syntax (unlikely for v1.0)
4. Run full test suite before deploying to production

### Feedback & Contributions
- Report bugs: [GitHub Issues](https://github.com/vncsleal/prisml/issues)
- Security vulnerabilities: security@iamvini.co
- Feature requests: [GitHub Discussions](https://github.com/vncsleal/prisml/discussions) (coming soon)
- Contributions welcome: Fork → Branch → Test → PR

### Future Roadmap
- **v1.1** (Q1 2025): Streaming predictions, additional database adapters, improved error messages
- **v1.2** (Q2 2025): GPU acceleration (ONNX GPU Runtime), distributed training
- **v2.0** (H2 2025): Web UI for model management, multi-tenant support

---

**For detailed feature information, see [docs/PRD.md](docs/PRD.md) and [docs/API.md](docs/API.md).**
