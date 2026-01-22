# PrisML Architecture

This document describes the high-level architecture of PrisML v2.0, emphasizing the separation between the **Core** (Synchronous/Local) and **Gen** (Asynchronous/Remote) layers.

---

## System Overview

```mermaid
graph TD
    UserApp[User Application (Next.js/Express)]
    
    subgraph "PrisML Runtime (In-Process)"
        PrismaClient[Prisma Client]
        Extension[PrisML Extension]
        
        subgraph "Core Layer (Sync)"
            FeatureEngine[Feature Engine]
            OnnxRuntime[ONNX Runtime (Node.js)]
            ModelCache[Model Cache (Singleton)]
        end
        
        subgraph "Gen Layer (Async)"
            VectorEngine[Vector Engine]
            GenFieldEngine[Generative Field Engine]
        end
    end
    
    subgraph "External Resources"
        DB[(PostgreSQL)]
        ModelArtifact[Model.onnx File]
        LLM[OpenAI / External API]
    end

    UserApp --> PrismaClient
    PrismaClient --> Extension
    
    %% Core Flow
    Extension -- "resolve(User)" --> FeatureEngine
    FeatureEngine -- "Feature Vector" --> OnnxRuntime
    OnnxRuntime -- "Load" --> ModelArtifact
    OnnxRuntime -- "Probability" --> Extension
    
    %% Gen Flow
    Extension -- "vectorSearch()" --> VectorEngine
    VectorEngine -- "pgvector Query" --> DB
    Extension -- "_gen.field" --> GenFieldEngine
    GenFieldEngine -- "HTTP" --> LLM
```

---

## 1. The Build Pipeline (CLI)

The `prisml train` command acts as a **compiler + orchestrator**, bridging TypeScript and Python ecosystems.

### 1.1 Phase 1: TypeScript Data Extraction

```typescript
// Runs in Node.js
const extractor = new PrismaDataExtractor(prisma, model);
const { features, labels } = await extractor.extractTrainingData();
```

**Steps:**
1.  **Introspection:** Reads `ml.ts` definitions and validates against `schema.prisma`
2.  **Query Generation:** Creates optimized Prisma query with batching (prevents OOM)
3.  **Feature Extraction:** Executes user's `resolve` functions on each entity
4.  **Validation:** Ensures types match, handles nulls, maintains deterministic order
5.  **CSV Export:** Writes features to temporary CSV for Python handoff

**Why TypeScript here?**
- Type safety: Can't access fields that don't exist
- DRY: Same code runs during inference
- Integration: Direct Prisma Client access

### 1.2 Phase 2: Python Training

```python
# Runs in subprocess (assets/python/trainer.py)
from sklearn.ensemble import RandomForestClassifier
from skl2onnx import convert_sklearn

clf = RandomForestClassifier(n_estimators=100, max_depth=10)
clf.fit(X_train, y_train)

onnx_model = convert_sklearn(clf, initial_types=...)
```

**Steps:**
1.  **Data Loading:** Reads CSV from temporary directory
2.  **Train/Test Split:** Deterministic split with stratification
3.  **Training:** Uses scikit-learn, XGBoost, or custom algorithms
4.  **Evaluation:** Calculates accuracy, precision, recall, F1
5.  **Quality Gate:** Fails build if `accuracy < minAccuracy` (CI/CD integration)
6.  **ONNX Export:** Converts trained model to portable format
7.  **Cleanup:** Returns metadata, removes temporary files

**Why Python here?**
- Ecosystem: Access to all scikit-learn algorithms
- Performance: Multi-threaded training (n_jobs=-1)
- Expertise: Your data scientists use Python
- ONNX: First-class export support

### 1.3 Phase 3: Artifact Storage

```typescript
// Back in Node.js
await fs.writeFile(
  'prisml/generated/ChurnModel.onnx',
  onnxBuffer
);
```

**Artifact Contents:**
- `model.onnx`: Binary ONNX model (commit to git)
- `metadata.json`: Training stats, feature names, accuracy
- `checksums.json`: Feature definition hash (prevents drift)

**Git Integration:**
Models are **versioned with code**. When you:
- Change feature logic → Retrain → New ONNX committed
- Deploy new version → Model matches code exactly
- Rollback code → Model rolls back too

### 1.4 Process Isolation Benefits

| Concern | Solution |
|---------|----------|
| Python version conflicts | Subprocess uses system Python or Docker |
| Node.js event loop blocking | Training runs in separate OS process |
| Memory leaks | Process exits after training, memory freed |
| Dependency hell | Python deps don't pollute node_modules |
| CI/CD | Easy to cache Python env separately |

### 1.5 Environment Auto-Detection

PrisML automatically selects the optimal training environment:

```typescript
// Detection algorithm
function detectEnvironment() {
  if (dockerAvailable()) {
    return 'docker';  // Best: Consistent, isolated
  }
  if (pythonAvailable() && hasRequiredPackages()) {
    return 'python';  // Good: Works if configured
  }
  if (datasetSize < 1000) {
    return 'js-fallback';  // Experimental: Tiny datasets only
  }
  throw new Error('Install Docker or Python');
}
```

**Detection Flow:**
1. Check for Docker daemon (`docker info`)
2. If Docker: Pull `prisml/trainer:latest` (cached after first run)
3. No Docker? Check for Python 3.8+ (`python3 --version`)
4. Verify packages: `import sklearn, onnx, skl2onnx`
5. No Python? Offer JS fallback for <1000 rows or exit with instructions

**User Experience:**
- With Docker: Zero configuration, works immediately
- Without Docker: One-time Python setup, clear instructions
- Override: `--use-docker` or `--use-local-python` flags

---

## 2. The Runtime (Client Extension)

PrisML hooks into the `prisma.$extends` API.

### 2.1 Core (Predictive Fields)
*   **Goal:** Zero-latency, deterministic prediction.
*   **Mechanism:**
    *   Intercepts `findUnique` / `findFirst`.
    *   If `_predictions` is requested:
        1.  Fetches the raw data required by the features (automatically adding `select` fields).
        2.  Passes raw data to `FeatureEngine` -> transforms to `Float32Array`.
        3.  Passes array to `OnnxRuntime.run()`.
        4.  Merges result back into the response object.

### 2.2 Gen (Generative Fields)
*   **Goal:** Managed async capabilities.
*   **Mechanism:**
    *   Intercepts `find*` queries.
    *   If `_gen` is requested:
        1.  Fetches base data.
        2.  Checks Cache (Redis/DB).
        3.  If miss, executes the `provider` (HTTP call).
        4.  Returns promise (or resolved value if awaited).

---

## 3. Data Flow & Type Safety

PrisML relies on TypeScript for end-to-end safety.

1.  **Definition Time:** `defineModel<User>` ensures you can only access valid `User` fields.
2.  **Train Time:** The extractor validates that the database actually contains the fields you asked for.
3.  **Inference Time:** The runtime checks that the `model.onnx` input shape matches the current code definition (checksum validation).

## 4. Operational Boundaries

| Property | PrisML Core | PrisML Gen |
| :--- | :--- | :--- |
| **Execution** | Synchronous (CPU) | Asynchronous (Network IO) |
| **Reliability** | Deterministic | Non-deterministic |
| **Cost** | Free (Compute) | $/Token |
| **Failure Mode** | Exception (Safe) | Timeout / Rate Limit |
| **Recommended Use** | Logic, Scoring, Routing | Content, Search, RAG |

---

## 5. Production Deployment

### 5.1 Zero Python Runtime

Production applications have **no Python dependencies**:

```json
// package.json (production)
{
  "dependencies": {
    "@prisma/client": "^5.8.0",
    "prisml": "^1.0.0",
    "onnxruntime-node": "^1.23.0"
  }
}
```

Python is **only used during `npm run build`** or CI/CD.

### 5.2 Performance Characteristics

| Metric | Expected Value |
|--------|----------------|
| Model load time | 50-200ms (one-time on startup) |
| Inference latency | 2-15ms per prediction |
| Memory overhead | 10-50MB per model |
| CPU usage | <1% for typical workloads |

### 5.3 Serverless Compatibility

**AWS Lambda / Vercel Functions:**
```typescript
// api/predict.ts
import { PrismaClient } from '@prisma/client';
import { prisml } from 'prisml';
import { ChurnModel } from '../prisma/ml/churn';

// Initialize outside handler (cached across invocations)
const prisma = new PrismaClient().$extends(
  prisml([ChurnModel])
);

export default async function handler(req, res) {
  // First call: ~200ms (model load)
  // Subsequent calls: <10ms (cached)
  const prediction = await prisma.user.findUnique({
    where: { id: req.query.userId },
    include: { _predictions: { isChurned: true } }
  });
  
  res.json(prediction);
}
```

**Optimizations:**
- Model files < 50MB (Lambda limit: 250MB unzipped)
- Use container deployment for larger models
- Preload in global scope (singleton pattern)

### 5.4 Model Versioning

Models are versioned with code in git:

```bash
# Feature change triggers retraining
git diff prisma/ml/churn.ts

# New model committed
git add prisml/generated/ChurnModel.onnx
git commit -m "feat: add user tier feature to churn model"

# Deploy with matching code + model
git push
```

**Benefits:**
- Atomic deploys (code + model always match)
- Easy rollbacks (git revert)
- PR reviews include model changes
- Reproducible builds

---

## 6. Distribution & Versioning

### 6.1 Package Distribution

**Core Package (`npm`):**
```bash
npm install @vncsleal/prisml
```

**Contents:**
- `defineModel()` - Type-safe model definition API
- Prisma Client Extension for `_predictions`
- ONNX Runtime integration
- CLI tools (`npx prisml train`)

**Optional Packages:**
- `@prisml/trainer` - Docker image for training (Docker Hub)
- `@prisml/action` - GitHub Action for CI/CD
- `@prisml/vscode` - VS Code extension (syntax highlighting, validation)

### 6.2 Semantic Versioning

Following [SemVer 2.0.0](https://semver.org/):

- **Major (1.0.0 → 2.0.0):** Breaking changes to `defineModel` API or runtime behavior
- **Minor (1.0.0 → 1.1.0):** New algorithms, features (backwards compatible)
- **Patch (1.0.0 → 1.0.1):** Bug fixes, security updates

### 6.3 Compatibility Matrix

| PrisML Version | Prisma Version | Node.js Version | Python (Training) |
|----------------|----------------|-----------------|-------------------|
| 1.0.x | 5.8.x - 6.x.x | >=18.0.0 | 3.8 - 3.12 |

### 6.4 License

**MIT License** for core package:
- No vendor lock-in
- Commercial use allowed
- Full transparency for security audits

**Future:** PrisML Cloud (paid tier) for remote training, monitoring, drift detection

---

## 7. Community & Support

- **GitHub:** [github.com/vinico/prisml](https://github.com/vinico/prisml)
- **Documentation:** [prisml.dev](https://prisml.dev)
- **Discord:** Community support and discussions
- **Examples:** Starter templates via `npx prisml init --template [name]`