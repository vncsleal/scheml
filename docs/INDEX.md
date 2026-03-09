# PrisML Documentation Index

## Start Here

1. **[README.md](README.md)** — Project overview and quick links
2. **[GETTING_STARTED.md](docs/GETTING_STARTED.md)** — 5-minute setup guide

## Core Documentation

### Architecture & Design
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System design, compilation pipeline, runtime model
- **[FEATURES.md](docs/FEATURES.md)** — Detailed feature specifications and rationale

### User Guide
- **[GUIDE.md](docs/GUIDE.md)** — Complete user guide with code examples
- **[API.md](docs/API.md)** — Complete API reference for all public functions

### Project Information
- **[ROADMAP.md](ROADMAP.md)** — Feature roadmap: v0.1.0 (current), V1 (beta), V2+
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Developer guide and contribution process

## Safety & Security
- **[SECURITY.md](docs/SECURITY.md)** — Safety guarantees, security considerations, best practices

## Examples
- **[examples/basic](examples/basic)** — Working example project with two models

---

## Quick Navigation

### If you want to...

**...understand the system architecture**
→ [ARCHITECTURE.md](docs/ARCHITECTURE.md)

**...get started quickly**
→ [GETTING_STARTED.md](docs/GETTING_STARTED.md)

**...learn the complete API**
→ [API.md](docs/API.md)

**...see code examples**
→ [GUIDE.md](docs/GUIDE.md) or [examples/basic](examples/basic)

**...understand design tradeoffs**
→ [FEATURES.md](docs/FEATURES.md)

**...plan for the future**
→ [ROADMAP.md](ROADMAP.md)

**...contribute to the project**
→ [CONTRIBUTING.md](CONTRIBUTING.md)

**...understand safety guarantees**
→ [SECURITY.md](docs/SECURITY.md)

**...see what's implemented**
→ [MANIFEST.md](../MANIFEST.md)

---

## Source Code Organization

```
packages/
  prisml/            @vncsleal/prisml — types, errors, CLI, runtime, Python backend

apps/
  website/           getprisml.vercel.app — documentation site and live demo

examples/
  basic/             Working example project
```

## Key Concepts

### defineModel()
Type-safe model definition:
```typescript
const model = defineModel<User>({
  name: 'userValue',
  modelName: 'User',
  output: { field: 'value', taskType: 'regression' },
  features: { age: (u) => u.age, isPremium: (u) => u.plan === 'pro' },
  algorithm: { name: 'forest', version: '1.0.0' },
});
```

### Schema Hashing
Models are bound to Prisma schema via SHA256 hash. If schema drifts, inference fails.

### Feature Resolvers
Pure functions that extract values from entities:
```typescript
features: {
  age: (user) => Date.now() - user.birthDate.getTime(),
  region: (user) => user.country,
}
```

### Quality Gates
Build-time constraints that prevent deploying low-quality models:
```typescript
qualityGates: [
  { metric: 'rmse', threshold: 500, comparison: 'lte' },
]
```

### Artifacts
Immutable model files committed to git:
- `model.metadata.json` — semantic contract
- `model.onnx` — executable ONNX binary

## Design Philosophy

**Core principle:** Determinism first, flexibility second.

**Tradeoffs:**
- Gain: Reproducibility, auditability, type safety
- Loss: Runtime flexibility, adaptive learning, experimentation

**Target:** Developers who prioritize correctness over flexibility.

---

## Version Information

- **Current**: v0.1.0
- **Beta**: v1.0 (Q2 2026)
- **Flexibility**: v2.0 (Q4 2026)

See [ROADMAP.md](ROADMAP.md) for detailed timeline.

---

## Support

### Questions?
- Check the relevant guide in docs/
- See examples/basic/ for working code
- Review error messages (they include context)

### Found a bug?
- Open an issue on GitHub
- Include reproduction steps
- Reference relevant documentation

### Want to contribute?
- Read [CONTRIBUTING.md](CONTRIBUTING.md)
- Follow the coding standards
- Submit PR with tests

---

## License

PrisML is open source (license TBD).

---

*Last updated: March 9, 2026*
