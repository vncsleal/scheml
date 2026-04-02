# ScheML Website Redesign Plan

> **Status:** Draft — iterating before implementation  
> **Scope:** `apps/website/src/pages/index.astro`, `demo.astro`, `layouts/BaseLayout.astro`  
> **Constraint:** `demoPrediction.ts` (SSR demo backend) is intentionally untouched until the demo section is redesigned and agreed upon.

---

## Product facts to respect

| | |
|---|---|
| Package | `@vncsleal/scheml` v0.3.1 |
| CLI | `scheml train` / `scheml check` |
| Artifact dir | `.scheml/` |
| Trait types | `predictive`, `anomaly`, `similarity`, `sequential`, `generative` |
| Adapters | Prisma (entity as model string), Drizzle (entity as table object), Zod (entity as schema object) |
| Positioning | *"ScheML is to machine learning what Prisma is to databases"* |

### Artifact formats (not just ONNX)

| Trait type | Binary output | Metadata |
|---|---|---|
| `predictive` | `<name>.onnx` | `<name>.predictive.json` |
| `sequential` | `<name>.onnx` | `<name>.sequential.json` |
| `anomaly` | *(none — model embedded as base64 in JSON)* | `<name>.anomaly.json` |
| `similarity` | `<name>.faiss` (≥50k rows) or `<name>.embeddings.npy` (<50k rows) | `<name>.similarity.json` |
| `generative` | *(none — compiled prompt template + AI SDK config in JSON)* | `<name>.generative.json` |

---

## 1. Global brand changes

Applies to `index.astro`, `demo.astro`, and `BaseLayout.astro`.

| Item | Current | Proposed |
|---|---|---|
| Brand name text | `PrisML` | `ScheML` |
| Breadcrumbs | `prisml` | `scheml` |
| GitHub URLs | `github.com/vncsleal/prisml` | `github.com/vncsleal/scheml` *(once repo renamed)* |
| `BaseLayout` `<title>` | `PrisML` | `ScheML` |
| `BaseLayout` meta description | "Compiler-first ML for TypeScript + Prisma with ONNX Runtime" | "Define intelligence traits in TypeScript. ScheML compiles them to versioned build artifacts and runs them in-process." |
| Demo page footer version | `v0.1.2` | `v0.3.1` |

---

## 2. Logo

**Current:** Abstract pixel-art rune using 7 `<rect>` elements in a `viewBox="-1.5 -1.5 8 8"` box, amber `#f1c21b` on dark `#161616`, `shape-rendering="crispEdges"`. The mark doesn't clearly read as any letter.

**Proposed:** Replace with a pixel "S" — three horizontal bars with the appropriate corner pixels — using the exact same aesthetic, dimensions, and viewBox.

```
■ ■ ■ ■ ■   row 0 — top bar
■ · · · ·   row 1 — top-left corner
■ ■ ■ ■ ■   row 2 — middle bar
· · · · ■   row 3 — bottom-right corner
■ ■ ■ ■ ■   row 4 — bottom bar
```

SVG `<rect>` drop-in (replaces the 7 existing rects inside the container):
```html
<rect x="0" y="0" width="5" height="1" fill="#f1c21b"/>
<rect x="0" y="1" width="1" height="1" fill="#f1c21b"/>
<rect x="0" y="2" width="5" height="1" fill="#f1c21b"/>
<rect x="4" y="3" width="1" height="1" fill="#f1c21b"/>
<rect x="0" y="4" width="5" height="1" fill="#f1c21b"/>
```

The three bars also visually echo the three-step compile pipeline (define → compile → infer). Works at 20px and 24px, no antialiasing required.

---

## 3. Home page (`index.astro`)

### 3.1 Hero

**Headline:** Keep — `"Machine learning that compiles."` is strong.

**Lead copy:**
- Current: `"Define predictive models in TypeScript. Compile to immutable ONNX artifacts at build time."`
- Proposed: `"Define intelligence traits — predictive, anomaly, similarity, sequential, or generative — in TypeScript. ScheML compiles them to versioned build artifacts and runs them in-process with zero infrastructure."`

**Trait pill row** (add below the lead, above the install command):
Five small non-interactive pills using `--amber-90` bg / `--amber-40` text to show breadth at a glance:
```
predictive  ·  anomaly  ·  similarity  ·  sequential  ·  generative
```

**Install command:** Keep as-is — `npm install @vncsleal/scheml`.

---

### 3.2 Pipeline bar

| Step | Current label | Proposed label |
|---|---|---|
| 1 | `Define` / TypeScript | `Define` / TypeScript — unchanged |
| 2 | `Compile` / Build time | `Compile` / Build time — unchanged |
| 3 | `Validate` / Quality gates | `Validate` / Quality gates — unchanged |
| 4 | `Predict` / In-process | **`Infer` / In-process** |

"Infer" covers all 5 trait types (predict, score, rank, generate). No structural change.

---

### 3.3 Workflow section

**Headline:** Keep — `"Three files. Zero infrastructure."`

**Sub-copy:** 
- Current: `"Models are defined as code, compiled at build time..."`
- Proposed: `"Define any intelligence trait in TypeScript, compile once, run in-process. Same feature resolvers at train time and inference time — the encoding cannot drift."`

**Major change: Trait type selector strip**

Add 5 pill buttons above the code tabs: `predictive` (default active) / `anomaly` / `similarity` / `sequential` / `generative`. Selecting a trait type swaps the content of the **Define** code panel. Compile and Infer tabs stay identical for all types.

**5 Define snippets:**

<details>
<summary>predictive (default, existing)</summary>

```ts
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const userChurn = defineTrait('User', {
  type: 'predictive',
  name: 'userChurn',
  target: 'willChurn',
  features: ['lastActiveAt', 'monthlySpend', 'supportTickets'],
  output: { field: 'willChurn', taskType: 'binary_classification' },
  algorithm: { name: 'gbm' },
  qualityGates: [{ metric: 'f1', threshold: 0.80, comparison: 'gte' }],
});

export default defineConfig({ traits: [userChurn] });
```
</details>

<details>
<summary>anomaly</summary>

```ts
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const orderFraud = defineTrait('Order', {
  type: 'anomaly',
  name: 'orderFraud',
  features: ['amount', 'itemCount', 'shippingCountry', 'accountAgeDays'],
  algorithm: { name: 'iforest' },
  qualityGates: [{ metric: 'roc_auc', threshold: 0.90, comparison: 'gte' }],
});

export default defineConfig({ traits: [orderFraud] });
```
</details>

<details>
<summary>similarity</summary>

```ts
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const productRecommend = defineTrait('Product', {
  type: 'similarity',
  name: 'productRecommend',
  features: ['category', 'price', 'brand', 'avgRating'],
  algorithm: { name: 'cosine' },
});

export default defineConfig({ traits: [productRecommend] });
```
</details>

<details>
<summary>sequential</summary>

```ts
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const sessionNext = defineTrait('SessionEvent', {
  type: 'sequential',
  name: 'sessionNext',
  features: ['eventType', 'pageUrl', 'dwellMs'],
  orderBy: 'createdAt',
  sequenceLength: 8,
  algorithm: { name: 'lstm' },
});

export default defineConfig({ traits: [sessionNext] });
```
</details>

<details>
<summary>generative</summary>

```ts
import { defineTrait, defineConfig } from '@vncsleal/scheml';

const productDescription = defineTrait('Product', {
  type: 'generative',
  name: 'productDescription',
  contextFields: ['name', 'category', 'specs'],
  output: { field: 'description' },
  provider: { sdk: 'ai', model: 'openai:gpt-4o-mini' },
});

export default defineConfig({ traits: [productDescription] });
```
</details>

**Infer tab** content updates per trait type:

| Trait | Method | Returns |
|---|---|---|
| `predictive` | `db.scheml.predict('userChurn', user)` | `{ prediction: "1" \| "0" }` |
| `anomaly` | `db.scheml.predict('orderFraud', order)` | `{ score: 0.87, isAnomaly: true }` |
| `similarity` | `db.scheml.findSimilar('productRecommend', seed, { limit: 10 })` | `Entity[]` ranked by similarity |
| `sequential` | `db.scheml.predict('sessionNext', sequence)` | `{ next: "checkout_page" }` |
| `generative` | `db.scheml.generate('productDescription', product)` | `{ description: "..." }` |

---

### 3.4 Features grid

Replace 8 cards. Drop "Deterministic encoding" (rolled into drift guard), "Typed errors" (moved / dropped), "Schema validation" (rolled into drift guard), "Batch prediction" (rolled into in-process card).

| # | Title | Body summary |
|---|---|---|
| 1 | **Compiler-first** | Trait definitions → versioned build artifacts. No model registry, no train/inference drift. Artifacts are deterministic across machines. |
| 2 | **Five trait types** | Predictive, anomaly, similarity, sequential, generative — one `defineTrait()` API. Each compiles to the right artifact format for its inference strategy. |
| 3 | **Three adapters** | Prisma (model string), Drizzle (table object), Zod (schema object). Same trait definition, swap the entity declaration. |
| 4 | **In-process inference** | ONNX Runtime, FAISS, and AI SDK calls run in-process. No serialization, no network hop. Predictive trait latency typically <1 ms. |
| 5 | **Schema drift guard** | Every artifact carries a SHA-256 hash of the schema at compile time. `db.scheml.predict()` re-hashes on every call — `SchemaDriftError` before a single inference runs. |
| 6 | **TraitGraph** | Chain traits into dependency graphs. Shared features are computed once and threaded through all dependent traits automatically. |
| 7 | **Quality gates** | Define metric thresholds (`f1`, `accuracy`, `roc_auc`, `rmse`) in your trait config. `scheml train` fails-fast — no silent regressions. |
| 8 | **Feedback loop** | `db.scheml.record()` / `db.scheml.recordBatch()` push observed outcomes back. Re-run `scheml train` to close the loop without changing your schema. |

---

### 3.5 Architecture section

**Heading:**
- Current: `"Models as build artifacts."`
- Proposed: `"Traits as build artifacts."`

**Sub-description:**
- Current: `"PrisML treats machine learning models the same way a compiler treats source code..."`
- Proposed: `"ScheML treats intelligence traits the same way a compiler treats source code — as deterministic transformations from declaration to artifact."`

**Arch card updates:**

| Card | Title | Key changes |
|---|---|---|
| 01 | Declaration | Tags: `defineTrait()` · `Prisma · Drizzle · Zod` · `Type-safe`. Body: mention 3 adapters. |
| 02 | Compilation | Body: generalize beyond Prisma extraction → covers all adapters. Mention 4 artifact formats (ONNX, FAISS/npy, embedded pickle, JSON config). Tags: `scheml train` · `ONNX / FAISS / AI SDK` · `Schema hash` |
| 03 | Inference | Replace `PredictionSession` with `extendClient` pattern. Tags: `extendClient()` · `In-process` · `Deterministic` |

---

### 3.6 Supported section

Expand from 3 columns to 4.

**Task types** (add below existing 3):
- ✓ Anomaly detection
- ✓ Similarity / nearest-neighbour
- ✓ Sequential prediction
- ✓ Generative (AI SDK)

**Add new column — Adapters:**
- ✓ Prisma (model string)
- ✓ Drizzle (table object)
- ✓ Zod (schema object)

---

### 3.7 CTA section

- Heading: Keep — `"Start building."`
- Body: `"Add PrisML to your TypeScript project and define your first model in minutes."` → `"Add ScheML to your TypeScript project and define your first trait in minutes."`
- Button URLs: `prisml` → `scheml` throughout.

---

## 4. Demo page (`demo.astro`)

The three-section layout (Live Inference → Drift Guard → Integration) is solid and stays.

### 4.1 Scattered brand text

All `PrisML` → `ScheML`, breadcrumb `prisml/demo` → `scheml/demo`, version `v0.1.2` → `v0.3.1`, logo SVG → new S mark (same as §2).

### 4.2 Hero

**Keep:** Headline, lead, all 4 meta pills (artifact / algorithm / task / compiled) — all correct for the predictive demo.

**Add:** Trait type pills row below the meta pills, showing where this demo sits:
```
[ predictive ✓ ]  [ anomaly ]  [ similarity ]  [ sequential ]  [ generative ]
```
Active = amber, others = dimmed with "coming soon" tooltip on hover. Communicates product breadth without requiring additional demo infrastructure.

### 4.3 Live Inference section

**Keep:** All slider logic, preset buttons, result panel, schema hash display, latency bars.

**Text updates:**
- Section description: `session.predict()` → `db.scheml.predict()` via the `extendClient` adapter.
- Latency bar label: `"PrisML in-process"` → `"ScheML in-process"`
- Latency footnote: `"PrisML runs ONNX Runtime..."` → `"ScheML runs ONNX Runtime..."`

### 4.4 Schema Drift Guard section

**Keep:** Toggle UI, schema diff panel, SchemaDriftError display — these are the best differentiator on the page.

**Text updates:**
- Description: `PredictionSession throws SchemaDriftError` → `ScheML throws SchemaDriftError` (via `db.scheml.predict()`)
- Drift explanation paragraph: `PredictionSession holds a3f8c1b2` → `ScheML re-hashes the current schema on every db.scheml.predict() call`

### 4.5 Integration section

**Header sub-copy:** `"Define a model in TypeScript..."` → `"Define a trait in TypeScript..."`

**Major change: Adapter sub-selector on Define tab**

Keep 3 main tabs (Define / Compile / Infer). Add an `[adapter]` sub-selector inside the **Define** tab: `[ Prisma ]  [ Drizzle ]  [ Zod ]`. Swaps only the `defineTrait()` entity declaration — the rest of the snippet is identical. Compile and Infer tabs stay unchanged.

| Adapter | Entity declaration |
|---|---|
| Prisma | `defineTrait('User', { ... })` — string model name |
| Drizzle | `defineTrait(usersTable, { ... })` — imported table object |
| Zod | `defineTrait(userSchema, { ... })` — imported Zod schema |

---

## 5. UI / UX design improvements

> **Constraints:**
> - Keep IBM Carbon g100 dark palette, IBM Plex Sans + Mono, amber `#f1c21b`, flat/sharp-edge aesthetic.
> - No radial gradients, no decoration shadows, no rounded cards.
> - Dot-grid only if animated **and** cursor-interactive.
> - **Animation must be pervasive, paced, and noticeable throughout the entire page.** Not micro-interaction speed (≤120ms), not slow drift (≥800ms). Target 350–500ms for content transitions, 250ms for interactive elements. Stagger groups of elements so the sequence reads, not just registers.

---

### 5.1 Motion philosophy — the whole page contract

Every section follows the same motion grammar, applied consistently:

| Motion category | Timing | Easing | Usage |
|---|---|---|---|
| Page entrance (hero) | 500ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Breadcrumb → title → lead → pills → install, 120ms apart |
| Scroll reveal | 450ms | `cubic-bezier(0.16, 1, 0.3, 1)` | All section headers, cards, columns — translate(0, 24px) → 0 |
| Interactive (hover/click) | 250ms | `ease` | Buttons, tabs, cards, nav links |
| Panel/content swap | 350ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Tab switches, trait selector, adapter selector |
| Ambient/loop | 2000ms | `ease-in-out` | Pipeline pulse, pipeline connector draw |
| Cursor reactive | 60ms | `linear` | Dot grid, pipeline connector follow |

**Shared keyframes (define once, use everywhere):**
```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes drawRight {
  from { width: 0; }
  to   { width: 100%; }
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(241, 194, 27, 0.35); }
  50%       { box-shadow: 0 0 0 8px rgba(241, 194, 27, 0); }
}
```

---

### 5.2 Hero — cursor-interactive dot grid

No static background layer. No gradient wash. The hero background is `#161616` — pure. The only visual depth comes from an animated, cursor-reactive dot grid rendered on a `<canvas>` element that fills the hero section.

**Behavior:**
- Dots drawn on a 24px grid (aligns to `--sp-3`), `rgba(255,255,255,0.055)` at rest.
- On `mousemove`: dots within ~150px radius of cursor brighten toward `rgba(241, 194, 27, 0.45)` (amber) using a distance-decay function. The effect trails — dots fade back to their rest color at 60fps over ~400ms after the cursor leaves their radius.
- Result: the user's cursor "illuminates" the grid as they move — like scanning a dark surface with a torch. Computational, tactile, and unique.
- On mobile (no cursor): grid renders at rest opacity, no interactivity. Still adds texture.

**Implementation approach:**
```js
// In the astro:page-load handler
const canvas = document.getElementById('heroCanvas');
const ctx = canvas.getContext('2d');
const GRID = 24;
const dots = []; // { x, y, brightness } per grid intersection
let mouse = { x: -9999, y: -9999 };
const RADIUS = 150;
const AMBER = [241, 194, 27];
const REST_ALPHA = 0.055;
const PEAK_ALPHA = 0.45;

// Populate dots, resize handler, RAF loop:
// Each frame: for each dot, compute distance to mouse, set brightness,
// lerp brightness toward target at ~0.07 per frame (smooth decay ~400ms)
// Draw filled circle 2px at (dot.x, dot.y) with rgba at current brightness

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
});
canvas.addEventListener('mouseleave', () => { mouse = { x: -9999, y: -9999 }; });
```

**CSS:**
```css
.hero {
  position: relative;
  overflow: hidden;
}
#heroCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* hero content above; canvas only for visual */
}
/* Give the canvas pointer-events for mousemove — attach to .hero instead,
   pass coords in, so hero content remains interactive */
```

---

### 5.3 Hero — entrance animation (paced)

The hero has no entrance animation today. Apply the motion grammar from §5.1 — elements assemble in sequence, each step clearly visible:

```css
.hero__breadcrumb { animation: fadeUp 500ms cubic-bezier(0.16,1,0.3,1) both; }
.hero__title      { animation: fadeUp 500ms cubic-bezier(0.16,1,0.3,1) 120ms both; }
.hero__lead       { animation: fadeUp 500ms cubic-bezier(0.16,1,0.3,1) 240ms both; }
.trait-pills      { animation: fadeUp 500ms cubic-bezier(0.16,1,0.3,1) 360ms both; }
.hero__actions    { animation: fadeUp 500ms cubic-bezier(0.16,1,0.3,1) 480ms both; }
```

On the right-hand code preview (see §5.4): animate in 80ms after `.hero__actions` with `fadeUp` from slightly further (translating from 32px, not 24px), giving it a slight "heavier object" feel.

---

### 5.4 Hero layout — 60/40 split with code preview

Split the hero into a 60/40 column layout on desktop (≥1024px):
- **Left (60%):** All current hero content — breadcrumb, title, lead, trait pills, install command.
- **Right (40%):** A `defineTrait()` snippet card — `<Code>` block with `github-dark` theme, wrapped in an amber-bordered panel (`border: 1px solid rgba(241,194,27,0.3)`). This card floats slightly (no outer container padding on the right side) to overlap the hero bottom border.
- On mobile/tablet: right column hides. 

This is the single highest-impact structural change — answers "what does the code look like" before the user scrolls.

---

### 5.5 Typography hierarchy

- **Hero title:** wrap the punchline in `<strong>` at `font-weight: 600` — `"Machine learning <strong>that compiles.</strong>"`. One bold phrase per headline maximum.
- **Section titles:** `font-weight: 300` → `font-weight: 400`. Lifts readability at section entry points.
- **Section tags (amber mono, all-caps):** add `border-left: 2px solid var(--amber-50); padding-left: 8px;`. IBM Data Studio pattern — the tag reads as a category marker, not decoration.
- **Arch card numbers `01/02/03`:** keep as 12px mono, but add a 96px watermark version behind the card (see §5.8).

---

### 5.6 Pipeline bar — animated connector + step entrance

**Connector line:** Replace the static SVG `→` connector with a `<span>` that uses CSS `drawRight` animation, triggered when the pipeline section enters the viewport:
```css
.pipeline__connector-line {
  display: block;
  height: 1px;
  background: var(--amber-60);
  width: 0;
  transition: none;
}
.pipeline.revealed .pipeline__connector-line {
  animation: drawRight 600ms cubic-bezier(0.16,1,0.3,1) forwards;
}
/* Stagger each connector: delay by step index × 200ms */
.pipeline__connector:nth-child(2) .pipeline__connector-line { animation-delay: 200ms; }
.pipeline__connector:nth-child(4) .pipeline__connector-line { animation-delay: 400ms; }
.pipeline__connector:nth-child(6) .pipeline__connector-line { animation-delay: 600ms; }
```

**Step icons:** Each step box fades up with stagger as the line reaches it:
```css
.pipeline.revealed .pipeline__step:nth-child(1) { animation: fadeUp 400ms cubic-bezier(0.16,1,0.3,1) both; }
.pipeline.revealed .pipeline__step:nth-child(3) { animation: fadeUp 400ms cubic-bezier(0.16,1,0.3,1) 200ms both; }
.pipeline.revealed .pipeline__step:nth-child(5) { animation: fadeUp 400ms cubic-bezier(0.16,1,0.3,1) 400ms both; }
.pipeline.revealed .pipeline__step:nth-child(7) { animation: fadeUp 400ms cubic-bezier(0.16,1,0.3,1) 600ms both; }
```

**Accent step pulse:** The `Compile` step (amber-bordered icon box) runs a continuous heartbeat after it animates in:
```css
.pipeline__icon--accent {
  animation: pulse 2200ms ease-in-out 1000ms infinite;
}
```

---

### 5.7 Section headers — reveal with amber rule draw

Every section header (`section-tag` → `section-title` → `section-desc`) currently fades+translates on intersect. Extend: before the tag text, draw a short amber horizontal rule left-to-right, then the tag fades in:

```css
.section-tag::before {
  content: '';
  display: inline-block;
  width: 0;
  height: 1px;
  background: var(--amber-50);
  vertical-align: middle;
  margin-right: 8px;
  transition: width 350ms cubic-bezier(0.16,1,0.3,1);
}
.section-header.revealed .section-tag::before {
  width: 24px;
}
```

Then title fades up at 100ms delay, desc at 220ms. Every section on the page has this consistent opener.

---

### 5.8 Feature cards — stagger + hover motion

**Scroll entrance:** Increase stagger spread. Currently delays go up to 400ms for 6 cards. With 8 cards at 4-col → 2 rows, stagger per row independently:
- Row 1 (cards 1–4): delays 0, 80, 160, 240ms
- Row 2 (cards 5–8): delays 0, 80, 160, 240ms (reset — triggered when row 2 enters viewport separately)

**Hover:** Replace the barely-visible `bg-elevated` hover with a compound effect:
1. `background` steps from `--bg` to `--bg-elevated` (currently exists, keep)
2. `border-left: 2px solid var(--amber-60)` animates in — shifts padding to avoid layout jump: `padding-left: calc(var(--sp-6) - 2px)` — transition `border-color 250ms ease`
3. The card icon lifts: `transform: translateY(-3px)` at `250ms ease`

**Icon differentiation:**
- 3 ScheML-unique cards (TraitGraph, Feedback loop, Five trait types): amber-tinted icon well — `background: rgba(241,194,27,0.07); border: 1px solid rgba(241,194,27,0.18); color: var(--amber-50)`.
- 5 foundational cards: neutral (as today).

**Grid:** Switch to **4-column** on desktop — 4+4 = two clean rows. 2-col on tablet, 1-col on mobile.

---

### 5.9 Arch cards — watermark numbers + staggered reveal

**Watermark:**
```css
.arch-card {
  position: relative;
  overflow: hidden;
}
.arch-card::before {
  content: attr(data-num); /* data-num="01" on each element */
  position: absolute;
  right: -12px;
  top: -20px;
  font-family: var(--font-mono);
  font-size: 112px;
  font-weight: 700;
  color: var(--amber-50);
  opacity: 0;
  pointer-events: none;
  line-height: 1;
  user-select: none;
  transition: opacity 600ms ease;
}
.arch-card.revealed::before {
  opacity: 0.04;
}
```
The watermark fades in slightly after the card's content — not simultaneously. Since opacity is separate from the card's `fadeUp`, it lags ~200ms, giving a layered reveal.

**Stagger:** Current 120ms/240ms delays — increase to 160ms/320ms for more noticeable sequencing.

---

### 5.10 Code tabs — directional panel transition

**Tab switch:** Track which direction the user navigated (left tab index vs. right) and slide the incoming panel from the correct direction:
```js
const direction = newIndex > prevIndex ? 1 : -1;
// incoming panel animates from translateX(direction * 24px), opacity 0
// → translateX(0), opacity 1 over 350ms
```

```css
@keyframes panelInRight { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
@keyframes panelInLeft  { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: translateX(0); } }
.code-panel.entering-right { animation: panelInRight 350ms cubic-bezier(0.16,1,0.3,1) both; }
.code-panel.entering-left  { animation: panelInLeft  350ms cubic-bezier(0.16,1,0.3,1) both; }
```

**Active indicator:** Thin amber left bar on the code panel itself (not just the tab's bottom border):
```css
.code-panel.active {
  border-left: 2px solid var(--amber-60);
  margin-left: -2px; /* avoid layout shift */
}
```

---

### 5.11 Trait selector — content swap animation

When the user clicks a trait button, the Define code panel content swaps with the same directional animation as §5.10. Additionally:
- The active `.trait-btn` flashes its background from `--amber-90` to `--amber-60` in 80ms then settles, giving the button press a tactile "click" feel.
- The tab bar itself gets a brief `translateX(0) scale(1.01) → scale(1)` nudge on selection at 200ms — more noticeable than just a color change.

---

### 5.12 Supported section — counter animation

Each list item enters with a stagger (40ms between items, 3 columns staggered by 120ms). The checkmark icon gets its own entrance: scales from `scale(0) → scale(1.2) → scale(1)` at `cubic-bezier(0.34, 1.56, 0.64, 1)` (slight overshoot spring). Makes the ✓ checkmarks feel confirmed rather than just text.

```css
@keyframes checkPop {
  0%   { transform: scale(0); opacity: 0; }
  70%  { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); }
}
.supported__col.revealed .supported__check {
  animation: checkPop 400ms cubic-bezier(0.34,1.56,0.64,1) both;
}
/* Stagger per list item */
.supported__list li:nth-child(1) .supported__check { animation-delay: 0ms; }
.supported__list li:nth-child(2) .supported__check { animation-delay: 60ms; }
.supported__list li:nth-child(3) .supported__check { animation-delay: 120ms; }
.supported__list li:nth-child(4) .supported__check { animation-delay: 180ms; }
.supported__list li:nth-child(5) .supported__check { animation-delay: 240ms; }
```

---

### 5.13 CTA section — line draw + headline scale

**Amber rule draw:** A 48px horizontal `--amber-60` line above the CTA headline draws left-to-right on scroll enter at `drawRight 500ms`:
```css
.cta__rule {
  display: block;
  height: 1px;
  background: var(--amber-60);
  width: 0;
  margin-bottom: var(--sp-5);
}
.cta.revealed .cta__rule {
  animation: drawRight 500ms cubic-bezier(0.16,1,0.3,1) both;
}
```

**Headline scale:** CTA title animates in with a very slight scale — `scale(0.96) translateY(16px) → scale(1) translateY(0)` at 500ms, 80ms after the rule finishes drawing. Gives the headline a "planting" feel, not just a fade.

**Headline size:** Remove `max-width: 480px` on `.cta__inner` for the heading. Let "Start building." span full container width at `clamp(2.5rem, 5vw, 4rem)` — the final statement should be large.

---

### 5.14 Scroll progress indicator

1px amber line fixed at the top of the viewport, filling left-to-right:
```css
.scroll-progress {
  position: fixed;
  top: 0; left: 0;
  height: 1px;
  width: 0%;
  background: var(--amber-60);
  z-index: 200;
  transition: width 40ms linear;
}
```
```js
window.addEventListener('scroll', () => {
  const pct = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
  document.querySelector('.scroll-progress').style.width = `${pct}%`;
}, { passive: true });
```

---

### 5.15 New UI components — full CSS specs

#### Trait type selector strip
```css
.trait-selector {
  display: flex;
  border: 1px solid var(--border-subtle);
  margin-bottom: var(--sp-5);
  overflow-x: auto;
}
.trait-btn {
  padding: 0 var(--sp-5);
  height: 40px;
  background: var(--bg);
  border: none;
  border-right: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 250ms ease, color 250ms ease, transform 200ms ease;
  white-space: nowrap;
}
.trait-btn:last-child { border-right: none; }
.trait-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
.trait-btn:active { transform: scale(0.98); }
.trait-btn.active {
  background: var(--amber-60);
  color: var(--gray-100);
  font-weight: 600;
}
```

#### Adapter sub-selector
```css
.adapter-selector {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-6);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}
.adapter-btn {
  padding: 2px 12px;
  height: 28px;
  font-family: var(--font-mono);
  font-size: 11px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 250ms ease, color 250ms ease, background 250ms ease;
}
.adapter-btn:hover { background: var(--bg); color: var(--text-primary); }
.adapter-btn.active {
  border-color: var(--amber-50);
  color: var(--amber-50);
  background: var(--bg);
}
```

#### Trait pills (hero)
```css
.trait-pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-bottom: var(--sp-8);
}
.trait-pill {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 3px 10px;
  background: var(--amber-90);
  color: var(--amber-40);
  border: 1px solid rgba(241, 194, 27, 0.2);
  letter-spacing: 0.02em;
  animation: fadeIn 500ms cubic-bezier(0.16,1,0.3,1) both;
}
/* Stagger each pill */
.trait-pill:nth-child(1) { animation-delay: 360ms; }
.trait-pill:nth-child(2) { animation-delay: 420ms; }
.trait-pill:nth-child(3) { animation-delay: 480ms; }
.trait-pill:nth-child(4) { animation-delay: 540ms; }
.trait-pill:nth-child(5) { animation-delay: 600ms; }
```

---

### 5.16 Responsive breakpoints

| Breakpoint | Changes |
|---|---|
| `< 640px` | 1-col everywhere. Trait pills wrap. Hero code preview hidden. Pipeline scrolls horizontally. |
| `640px – 1023px` | 2-col features grid. Arch cards 1-col stack. Supported 2-col. Hero no split. |
| `≥ 1024px` | Full: hero 60/40, 4-col features, 3-col arch, 4-col supported. |

All animated elements respect `@media (prefers-reduced-motion: reduce)` — if set, replace animations with instant opacity transitions only.

---

### 5.17 Scrollbar

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--gray-70); }
::-webkit-scrollbar-thumb:hover { background: var(--gray-50); }
```

---

## 6. Implementation order

Steps are sequenced so later steps don't break earlier ones.

1. `BaseLayout.astro` — meta description, title
2. Logo SVG — new S mark in `index.astro` (header × 1, footer × 1) + `demo.astro` (header × 1, footer × 1)
3. Text sweep — all `PrisML` → `ScheML`, all `prisml` breadcrumbs, all GitHub URLs, demo version
4. `index.astro` hero — lead copy + trait pill row
5. `index.astro` pipeline bar — `Predict` → `Infer`
6. `index.astro` workflow — trait selector + 5 define snippets + infer tab per-type content
7. `index.astro` features — replace 8 cards
8. `index.astro` arch section — heading + card bodies + tags
9. `index.astro` supported — expand task types + add adapters column
10. `index.astro` CTA — copy update
11. `demo.astro` — hero trait pills row + scattered text updates
12. `demo.astro` — inference + drift sections text updates
13. `demo.astro` — integration Define tab adapter sub-selector
14. `demoPrediction.ts` — update to `extendClient` pattern *(real API change, separate step)*

---

## 7. Open questions

- [ ] Confirm `sequential` `defineTrait` option names (`orderBy`, `sequenceLength`) against actual types
- [ ] Confirm `generative` `defineTrait` option names (`contextFields`, `provider.sdk`, `provider.model`) against actual types
- [ ] Confirm `anomaly` quality gate metric name (`roc_auc` vs `rocAuc` or similar)
- [ ] Confirm `db.scheml.findSimilar` is the actual method name for similarity traits
- [ ] Confirm `db.scheml.generate` is the actual method name for generative traits
- [ ] GitHub repo rename timing — URLs in CTA/footer should be updated in sync
