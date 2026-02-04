# PrisML Roadmap

## MVP (Current) — v0.1.0

**Release:** February 2026

**Focus:** Prove core concept—compile-first, schema-safe, deterministic ML

**Status:** Implementation complete

**Key features:**
- defineModel() type-safe API
- Schema hashing + runtime validation
- CLI: prisml train pipeline
- Runtime inference engine (ONNX Runtime)
- Complete error taxonomy
- Full documentation

**Limitations:**
- No test coverage
- Not published to npm

---

## V1.0 — Beta Release (Q1 2026)

**Focus:** Production-ready core system

**Implementation priorities:**
1. Comprehensive testing
   - Unit tests (core types, encoding, errors)
   - Integration tests (train → infer pipeline)
   - Regression suite
   - Performance benchmarks

2. Publishing & CI/CD
   - npm registry publish
   - GitHub Actions CI
   - SemVer versioning
   - Release process

3. Quality & hardening
   - Full error handling
   - Edge case testing
   - Performance optimization
   - Security audit

**Breaking changes:** None expected

---

## V2.0 — Flexibility Release (Q2-Q3 2026)

**Focus:** Support adaptive learning and experimentation

**New features:**

### Runtime Model Selection
- Load multiple model versions at runtime
- Select model based on context or request
- Support A/B testing via metadata
- Gradual rollout mechanisms

### Incremental Retraining
- Hot-reload model updates
- Gradual schema migrations
- Zero-downtime model updates
- Model version compatibility layer

### Multi-Tenant Schemas
- Support heterogeneous Prisma schemas
- Per-tenant model isolation
- Shared model inference
- Schema federation layer

### Online Learning Mode (Opt-in)
- Collect training signal from production
- Batch retraining jobs
- Feedback loop integration
- Experiment tracking

### Feature Store Integration
- Optional external feature serving
- Cached feature fetching
- Feature lineage tracking
- Audit logging

**Backward compatibility:** Full. V1 code works unchanged with V2.

**Tradeoffs:** Increases complexity but maintains core determinism guarantees.

---

## V3.0+ — Future (2026+)

Potential areas:
- Multi-model ensemble support
- Causal inference primitives
- Fairness & bias detection
- Explainability / SHAP integration
- GraphQL / REST API layer
- Distributed inference
- Hardware acceleration (GPU/TPU)

---

## Non-Goals

- Replacing feature stores (out of scope)
- ML platforms like MLflow (out of scope)
- AutoML (intentionally excluded)
- Deep learning frameworks (not suitable for this model)
- Real-time model serving (use Seldon / TFServing)

---

## Success Metrics

By V1.0:
- [OK] Deterministic predictions with reproducible artifacts
- [OK] Schema safety enforced (no silent drift)
- [OK] Production-ready Python backend
- [OK] 100+ lines of documentation
- [OK] Working examples (regression + classification)

By V2.0:
- [PLANNED] Support adaptive learning workflows
- [PLANNED] Support multi-tenant use cases
- [PLANNED] Ecosystem adoption (5+external models)
- [PLANNED] Community contributions

---

## Release Cadence

- **MVP (v0.1.0):** Feb 2026 (internal)
- **V1.0 (Beta):** May 2026 (public)
- **V1.x (Maintenance):** Jun-Aug 2026
- **V2.0 (Flexibility):** Sep 2026
- **V3.0 (Ecosystem):** 2027

---

## Compatibility Promise

**Artifact compatibility:**
- ONNX models are forward-compatible
- Metadata schema is versioned
- Breaking changes require major version bump
- Clear migration guides provided

**API compatibility:**
- Semantic versioning enforced
- Deprecation warnings 2 releases before removal
- Community feedback drives decisions

---

## Community & Contributions

- Open source from day one (V1.0)
- RFC process for major features
- GitHub discussions for feedback
- Regular sync with Prisma team
