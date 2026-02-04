# Single Package Distribution Strategy

## Overview

PrisML is distributed as separate npm packages for clarity: `@vncsleal/prisml-core`, `@vncsleal/prisml-cli`, and `@vncsleal/prisml-runtime`.

## Architecture Decision

**Monorepo for Development** | **Single Package for npm**

- Internal packages (`packages/core`, `packages/cli`, `packages/runtime`) organize code by concern during development
- Turbo orchestrates builds and testing across packages
- Single published package provides convenient UX for end users

## Benefits

### For Users
- ✅ Clear package boundaries: `npm install @vncsleal/prisml-core @vncsleal/prisml-cli @vncsleal/prisml-runtime`
- ✅ No version mismatches between core, cli, and runtime
- ✅ Simpler imports with selective exports
- ✅ Smaller decision tree ("do I need core? cli? runtime?")

### For Development
- ✅ Clear separation of concerns (types, CLI, inference engine)
- ✅ Independent testing and linting per package
- ✅ Faster builds with Turbo caching
- ✅ Easy to extract packages later if needed

## Package Contents

The published packages contain:

```
@vncsleal/prisml-core/
├── dist/
│   ├── index.js           # Main exports
│   ├── index.d.ts         # Type definitions
│   ├── core/              # Type system, schema hashing, analysis
│   ├── cli/               # Training compilation command
│   └── runtime/           # Prediction engine
├── package.json
├── README.md
└── LICENSE
```

## Import Patterns

Users can import from the main package or subpaths:

```typescript
// Main exports (recommended for most users)
import { defineModel } from '@vncsleal/prisml-core';
import { PredictionSession } from '@vncsleal/prisml-runtime';

// Selective subpath imports (if tree-shaking needed)
import { defineModel } from '@vncsleal/prisml-core';
import { PredictionSession } from '@vncsleal/prisml-runtime';

// CLI usage
npx @vncsleal/prisml-cli train --config prisml.config.ts
```

## Build Process

The npm package is built by:

1. Compiling each internal package (`packages/core`, `packages/cli`, `packages/runtime`)
2. Aggregating compiled outputs into single `dist/` directory
3. Creating `package.json` with exports pointing to consolidated dist/
4. Publishing single tarball to npm

## Version Strategy

- All three internal packages share the same version number
- Version bumped in root `package.json`
- Single npm release per version

## Future Flexibility

If in the future there's demand for smaller downloads (e.g., users only needing the runtime):

1. Keep separate packages: `@vncsleal/prisml-runtime` stays independent
2. Split into separate npm packages with shared version via workspace
3. Users can opt-in to granular imports without breaking existing code

Current single-package approach is lowest friction for MVP, with clear upgrade path if needed.
