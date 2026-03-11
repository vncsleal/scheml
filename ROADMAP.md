# Product Roadmap: PrisML
**Product Vision:** Compiler-first machine learning for TypeScript + Prisma teams who want deterministic training, immutable artifacts, and local schema-safe inference without a separate ML platform.
**Last Updated:** March 11, 2026 | **Next Review:** April 8, 2026

---

## Product Language Rule

PrisML follows two naming systems on purpose:
- Prisma- and TypeScript-native naming for schema, entities, and model-definition concepts
- Python-ML-aligned naming and syntax for training, evaluation, metrics, preprocessing, and other ML-layer features

Rule:
- if a feature comes from the Prisma/app definition layer, it should feel native to Prisma and TypeScript
- if a feature comes from the ML/training layer, it should bridge toward established Python ML conventions instead of inventing new terminology

This is a design rule for all future ML-facing features.

---

## 🟢 NOW — Active Development
*Currently in progress. High certainty, locked scope. These bets are made.*

| Horizon | Confidence | Updated |
|---|---|---|
| 0–6 weeks | High | March 11, 2026 |

### Theme: Core Trust And Reliability

**Initiative:** ONNX Runtime Parity
- **Problem:** `prisml train` validates models under Python `onnxruntime`, while Node inference currently uses `onnxruntime-web`, which weakens the compile-first determinism guarantee.
- **Hypothesis:** If default Node inference moves to `onnxruntime-node`, train-time validation and runtime inference will align more closely because they will use the same ONNX execution family.
- **Target Outcomes:**
  - Default runtime inference matches the same ONNX runtime family used during training.
  - Runtime choice becomes explicit in package structure and documentation.
- **Owner:** Vinicius Leal | **Status:** In Design

**Initiative:** Compiler Output And Error UX
- **Problem:** `prisml train` still exposes too much implementation detail through raw-looking success and failure output, which makes the package harder to use and trust.
- **Hypothesis:** If compiler output becomes structured and failures become actionable, users will reach successful training faster because the tool will explain what happened and what to fix.
- **Target Outcomes:**
  - Successful `prisml train` runs end with a short structured summary.
  - Common failures map to stable error messages with clear remediation.
- **Owner:** Vinicius Leal | **Status:** In Design

**Initiative:** Preflight Training Validation
- **Problem:** Today, many training failures are discovered too late, after dataset materialization and Python handoff, even when the configuration or environment was already invalid.
- **Hypothesis:** If `prisml train` performs a preflight validation pass before spawning the real training run, failures will become earlier and clearer because config issues and backend readiness problems will be caught before execution crosses the Python boundary.
- **Target Outcomes:**
  - Unsupported algorithms and invalid task/algorithm combinations fail before Python training starts.
  - A curated set of supported hyperparameters and important parameter constraints are validated before handoff.
  - The Python training backend is checked for availability and expected package compatibility before dataset serialization and model training.
- **Owner:** Vinicius Leal | **Status:** In Design

**Initiative:** Categorical Feature Hardening
- **Problem:** Categorical encoding exists in the code path, but the contract around string and enum handling is not yet explicit and robust enough for a trust-first product.
- **Hypothesis:** If categorical handling becomes explicit in behavior and metadata, users will be able to rely on string and enum features because the encoding contract will be visible and deterministic.
- **Target Outcomes:**
  - String and enum features train and infer predictably.
  - Encoding behavior is clearly represented in artifact metadata.
- **Owner:** Vinicius Leal | **Status:** In Design

**Initiative:** Public Contract Freeze
- **Problem:** Later roadmap steps become harder to execute if the current narrow public surface is not explicitly stabilized first.
- **Hypothesis:** If the package contract is frozen around `defineModel()`, `PredictionSession`, `prisml train`, `prisml check`, and the artifact pair, future work will move faster because the base will stop shifting.
- **Target Outcomes:**
  - Core docs stop contradicting package behavior.
  - The current public package surface is treated as stable and intentionally narrow.
- **Owner:** Vinicius Leal | **Status:** In Design

---

## 🟡 NEXT — Scoping & Discovery
*Prioritized and directionally committed. The "why" is locked; the "how" is still forming.*

| Horizon | Confidence | Updated |
|---|---|---|
| 6–16 weeks | Medium | March 11, 2026 |

### Theme: Artifact Reviewability And Adoption

**Initiative:** Artifact Inspect And Diff Tooling
- **Problem:** Today, understanding what changed between two artifacts or what exactly was trained still requires reading source code or raw metadata directly.
- **Hypothesis:** If PrisML ships `inspect` and `diff` tooling, reviewability will become a real product feature because artifacts will be inspectable in a stable, human-readable way.
- **Dependency / Unlock:** Requires the NOW reliability work so the artifact contract and runtime behavior are trustworthy.
- **Target Outcomes:**
  - A user can inspect one artifact and compare two artifacts without opening implementation code.
  - Artifact review becomes usable in local workflows and CI.

**Initiative:** Artifact Identity In Metadata
- **Problem:** Today an artifact is identified mostly by file name, model name, timestamp, and hashes. That is enough for exact verification, but weak for human workflows like review, promotion, and comparison across builds.
- **Hypothesis:** If PrisML adds a human-readable artifact version or build ID alongside immutable machine identity like artifact hash and schema hash, model workflows will become easier to manage because users will have both exact technical identity and clear operational identity.
- **Dependency / Unlock:** Builds on the same hardened artifact contract required for inspect and diff tooling.
- **Target Outcomes:**
  - Every artifact has both a human-usable identity and an immutable machine identity.
  - Inspect, diff, and future team workflows can refer to a specific artifact cleanly without relying on file names alone.

**Initiative:** `prisml init`
- **Problem:** New users still need to understand too much before they can reach first success.
- **Hypothesis:** If PrisML generates a minimal working setup, adoption will improve because the path from install to first trained artifact will become shorter and more consistent.
- **Dependency / Unlock:** Builds on the NOW contract freeze and compiler UX improvements.
- **Target Outcomes:**
  - A new user can initialize a project with a minimal `prisml.config.ts` and clear next steps.

**Initiative:** `prisml check --strict`
- **Problem:** Schema-only validation exists, but the package still allows too many problems to survive until the training step.
- **Hypothesis:** If validation becomes stricter before training, users will catch bad resolvers and config problems earlier because the compiler path will fail sooner and more precisely.
- **Dependency / Unlock:** Builds on the NOW work around error UX and contract clarity.
- **Target Outcomes:**
  - More invalid model configurations fail during validation instead of during training.

**Initiative:** Configurable Training Split And Seed
- **Problem:** PrisML currently hardcodes split behavior in training, which is simple but too rigid for all datasets and tasks.
- **Hypothesis:** If split policy and seed become part of the declared training contract, users will get better control and clearer reproducibility because evaluation behavior will be explicit instead of hidden in implementation defaults.
- **Dependency / Unlock:** Builds on the product language rule: the user-facing design should bridge to established Python ML concepts while remaining simple for TypeScript developers.
- **Target Outcomes:**
  - Split policy becomes visible and eventually configurable as part of the model’s training contract.
  - Seed choice becomes explicit instead of remaining an internal hardcoded constant.

**Initiative:** Compatibility Matrix
- **Problem:** Users cannot easily tell which combinations of Node, Prisma, Python, OS, and runtime are officially supported versus merely expected to work.
- **Hypothesis:** If PrisML publishes a small, explicit compatibility matrix with support tiers, OSS trust will improve because users will know what is tested, what is expected, and what is unsupported.
- **Dependency / Unlock:** Builds on the NOW contract freeze so support claims reflect a stable package surface.
- **Target Outcomes:**
  - PrisML publishes a clear support policy for Node, Prisma, Python, OS, and runtime environments.
  - Supported, expected, untested, and unsupported environments are distinguished explicitly.

**Initiative:** Example Library Of Real Use Cases
- **Problem:** One example exists, but users still have limited reference points for how PrisML should look in different practical product scenarios.
- **Hypothesis:** If PrisML ships a small set of strong, realistic examples, adoption will improve because users will see how the package applies to familiar problems instead of only abstract API usage.
- **Dependency / Unlock:** Builds on the improved quickstart and clearer package contract so examples reinforce the intended workflow instead of compensating for unclear docs.
- **Target Outcomes:**
  - PrisML maintains a small example library covering a few strong use cases such as churn, LTV, lead scoring, or fraud/risk.
  - Examples demonstrate the real define -> train -> commit -> predict workflow in credible application contexts.

**Initiative:** Multi-Model Workflow
- **Problem:** The package can partially support multiple exported models, but this is not yet a deliberate, explicit workflow for real projects.
- **Hypothesis:** If multi-model training, artifact isolation, and loading become first-class, PrisML will fit repeated usage better because one project will be able to manage several models coherently.
- **Dependency / Unlock:** Depends on hardened artifacts and better inspection, so model growth does not create confusion.
- **Target Outcomes:**
  - One project can train and manage multiple models with predictable artifact layout and runtime loading.

**Initiative:** True Batch Inference
- **Problem:** `predictBatch()` exists, but it is still conceptually weaker than it should be if it relies on repeated single-row inference calls instead of one batched tensor execution path.
- **Hypothesis:** If PrisML executes batch predictions as one matrix-shaped ONNX input instead of a loop of single-row calls, repeated scoring workflows will become more efficient because inference overhead will drop and the API will better match the concept of a real batch.
- **Dependency / Unlock:** Builds on the runtime hardening work in NOW and fits naturally with repeated-usage workflows alongside multi-model support.
- **Target Outcomes:**
  - `predictBatch()` is implemented as a real batched tensor execution path.
  - Batch inference becomes a credible workflow for repeated scoring jobs, not just a convenience wrapper.

---

## 🔴 LATER — Future Horizons
*Strategic bets. Low certainty, wide scope. Good ideas parked until the time is right.*

| Horizon | Confidence | Updated |
|---|---|---|
| 16+ weeks | Low | March 11, 2026 |

### Theme: Commercialization And Scope Expansion

**Initiative:** Managed Artifact Governance Layer
- **Problem:** Once teams use PrisML seriously, local artifacts alone do not solve review, approval, provenance visibility, or promotion across environments.
- **Strategic Bet:** This will matter more later because team workflow and governance become painful only after the core package is trusted and used repeatedly.
- **Target Outcomes:**
  - A clear paid workflow exists around artifact registry, provenance, comparison, review, and promotion.
  - Artifact workflows use both human-readable build identity and immutable hashes, following the common pattern used in build, deployment, and migration tooling.

**Initiative:** Managed Training Workflow
- **Problem:** Some teams will eventually want a managed build path, but hosted training is operationally much heavier than artifact governance and is not required for current product fit.
- **Strategic Bet:** This will matter more later because it only becomes valuable after the artifact workflow proves useful and demand for managed execution is real.
- **Target Outcomes:**
  - Managed training is defined as an extension of the artifact workflow, not as the first commercial layer.

**Initiative:** Source Expansion Beyond Prisma
- **Problem:** Supporting Zod, Drizzle, or other typed sources would broaden the market, but it also changes the product category and support burden.
- **Strategic Bet:** This will matter more later because broader source support only makes sense after the Prisma-native workflow is clearly strong and there is demonstrated pull for expansion.
- **Target Outcomes:**
  - A clear decision framework exists for when and how to expand beyond Prisma.

**Initiative:** Training Data Filters
- **Problem:** Real models sometimes need a deliberate subset of rows for training rather than the full Prisma model table, but this changes the training contract in a meaningful way.
- **Strategic Bet:** This may matter later because larger or more mature workflows often need explicit training subsets, but the current package should not rush this into the public API before the design is settled.
- **Target Outcomes:**
  - PrisML captures this as a future design topic, not an approved implementation.
  - Any later design records the selected training subset as part of the artifact contract.

**Initiative:** Development Sampling / Row Limit
- **Problem:** Local iteration may eventually become slow on much larger datasets, but this is not a pressing product problem yet.
- **Strategic Bet:** This may matter later because larger databases will make local iteration more expensive, but it should only be designed once the real bottlenecks are clearer.
- **Target Outcomes:**
  - PrisML keeps this as a future consideration instead of committing to an immediate implementation.
  - Any later design distinguishes development-only sampling from the real training path used for trusted artifacts.

---

## ❌ Decided Against
*Explicitly killed ideas — with a reason. Prevents relitigating the same debates.*

| Initiative | Reason Rejected | Date |
|---|---|---|
| Online learning | Conflicts with immutable artifacts and the compile-first model | March 11, 2026 |
| Background retraining in core | Introduces runtime state and orchestration that do not belong in the package | March 11, 2026 |
| Feature store | Low alignment with the core package thesis; turns PrisML into infrastructure | March 11, 2026 |
| AutoML as a core product concern | Low leverage versus cost; pushes PrisML toward generic ML platform behavior | March 11, 2026 |
| A/B testing and traffic routing | Requires control-plane behavior outside the package thesis | March 11, 2026 |
| Runtime model mutation | Breaks determinism and artifact trust | March 11, 2026 |
| Active-model control plane | Better solved by systems outside PrisML core | March 11, 2026 |
| Generic model serving infrastructure | Misaligned with the local, artifact-centric product shape | March 11, 2026 |

---
**How to read this roadmap:** NOW is committed. NEXT is directional. LATER is a bet. Nothing here is a promise.
