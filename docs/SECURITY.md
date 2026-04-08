# ScheML Security & Safety

## Core Safety Guarantees

### Schema Validation

Every trained trait artifact is bound to an adapter-normalized entity hash (SHA256):

- The adapter reads the schema into a normalized schema graph
- A deterministic hash of the relevant entity is computed
- The hash is recorded in artifact metadata
- At runtime, **rejects predictions** if the current hash does not match the artifact

**Effect:** Prevents silent bugs from schema drift after artifact compilation.

This is **non-negotiable** and causes hard failures (not warnings).

### Deterministic Execution

Predictions are deterministic within platform guarantees:

- Same entity + same artifacts → same output (always)
- No random number generation in predictions
- No external service calls
- No time-dependent behavior

**Effect:** Trait artifacts are reproducible and auditable.

### Type Safety

Full TypeScript strict mode:

- No implicit `any`
- All types explicitly annotated
- Type checking at compile time
- Runtime validation for user inputs

**Effect:** Catches errors before runtime.

### Error Handling

No silent failures. All errors are typed:

```typescript
try {
  await session.predict(model, entity, resolvers);
} catch (error) {
  if (error instanceof SchemaDriftError) {
    // Schema changed - FATAL
  } else if (error instanceof UnseenCategoryError) {
    // New category - handle gracefully or retrain
  }
}
```

**Effect:** Developers can't ignore errors.

### Immutable Artifacts

Traits compile to immutable artifacts:

- Never modified after generation
- Committed to git (auditable)
- No runtime mutations
- Deterministic within numeric bounds

**Effect:** Artifacts don't change unexpectedly.

---

## Privacy & Data

### No Data Storage

ScheML does **not**:
- Store user data
- Log sensitive information
- Transmit data to external services
- Cache predictions

Data flows:
- Training: adapter extractor → Python backend (local) → ONNX artifacts
- Prediction: Application → session.predict() → output

### Training Data

During `scheml train`:
- Data is extracted via the configured adapter
- Processed locally via Python backend
- Not sent to external services
- Temporary `*.dataset.json` files are written to `.scheml/` for the Python backend. These files are deleted immediately after the Python process completes (whether it succeeds or fails).

### In Production

At runtime:
- Trait artifacts execute in-process
- No data leaves your application
- No telemetry or logging
- Feature data is transient (not stored)

---

## Operational Safety

### Quality Gates

Trainable trait artifacts must pass quality gates before export:

```typescript
qualityGates: [
  {
    metric: 'rmse',
    threshold: 500,
    comparison: 'lte',
  }
]
```

If any gate fails:
- Artifact generation **aborts**
- Exit code is non-zero
- No artifact is exported
- You must fix and retrain

**Effect:** Prevents deploying low-quality artifacts.

### Batch Validation

Batch predictions validate **all** entities before predictions:

```typescript
const results = await session.predictBatch(model, entities, resolvers);
```

If any entity fails validation:
- **Entire batch is aborted**
- No partial results
- Application must handle error
- Caller can retry or skip

**Effect:** Prevents partial failures and inconsistent state.

### Schema Drift Detection

If Prisma schema changes after artifact compilation:

```typescript
// Schema changed - hash mismatch
await session.predict(model, entity, resolvers);
// → throws SchemaDriftError
// → prediction STOPS
```

No predictions happen if schema drifts.

**Effect:** Prevents using stale trait artifacts with new schema.

---

## Security Considerations

### Code Injection

Feature resolvers are pure TypeScript functions compiled at build time. TypeScript's type system prevents most injection vectors:

```typescript
// SAFE: static property access
revenue: (user) => user.revenue

// UNSAFE: dynamic code
value: (user) => eval(user.expression) // Type error! [CAUGHT]
```

TypeScript's type system prevents this at compile time.

> **Note:** Static AST analysis of feature resolvers is not yet implemented. TypeScript provides compile-time safety, but callers are responsible for avoiding patterns like `eval` or dynamic `require` within feature resolvers.

### Artifact Formats

ONNX models are:
- Binary format (not executable code)
- Serialized numerical weights
- No dynamic code generation
- Safe to load from trusted sources

> **Important:** Anomaly trait artifacts (`*.metadata.json` for `type: 'anomaly'` traits) embed a base64-encoded `joblib` pickle, **not** an ONNX model. Python `pickle`/`joblib` deserialization can execute arbitrary code if the artifact has been tampered with. **Anomaly artifacts must only be loaded from trusted, integrity-verified sources.**

### Training Backend

Python backend should be:
- Run in isolated environment
- No external network access
- No dynamic code loading
- Pinned dependency versions

### Dependency Management

Dependencies should be:
- Pinned to specific versions
- Regularly audited for vulnerabilities
- Updated carefully with testing
- Scanned by npm audit

---

## Compliance

### Data Protection

If using ScheML in GDPR/CCPA jurisdiction:
- Trait artifacts don't store personal data
- Feature extraction is transient
- Artifacts are not PII
- Training data is your responsibility

### Artifact Governance

ScheML enforces:
- Reproducible training (git artifacts)
- Version tracking (metadata)
- Quality gates (automatic checks)
- Error reporting (typed errors)

This supports audit trails and compliance requirements.

### Fairness & Bias

ScheML does **not** provide:
- Bias detection
- Fairness metrics
- Protected group testing
- Explainability

These are **your responsibility** as a developer.

---

## Best Practices

### Training Safety

1. Use clean, representative data
2. Set meaningful quality gates
3. Review metrics before deploying
4. Test on hold-out set
5. Log training date and version

### Deployment Safety

1. Commit artifacts to git
2. Use feature branches for trait updates
3. Require code review for artifact changes
4. Monitor prediction errors in production
5. Retrain when schema changes

### Monitoring

Track in production:
- Prediction latency
- Error rates
- Unseen categories
- Schema drift failures
- Artifact version distribution

### Retraining

When to retrain:
- Schema changes (required)
- Distribution shift (data drift)
- New categories observed
- Quality gates lower threshold
- Algorithm update available

---

## Reporting Security Issues

If you find a security issue:

1. **Do not** create public GitHub issue
2. Email oi@iamvini.co (or project lead)
3. Include:
   - Description of issue
   - Reproduction steps
   - Potential impact
   - Suggested fix

We will:
- Acknowledge within 48 hours
- Investigate and confirm
- Develop fix in private branch
- Release security patch
- Credit discoverer (if desired)

---

## Security Audit

ScheML has **not** undergone formal security audit.

Before using in production:
- Review this document
- Review error handling code
- Test error cases
- Consider hiring security firm
- Monitor for CVEs in dependencies

---

## Third-Party Security

ScheML depends on:
- `@prisma/client` — database ORM
- `onnxruntime-node` — ONNX predictions
- `yargs` — CLI parsing
- TypeScript & Node.js — runtime

Monitor these for security issues.

---
