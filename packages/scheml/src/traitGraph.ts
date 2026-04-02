/**
 * Trait Graph — dependency DAG builder and cycle detector.
 *
 * `defineTrait` allows a trait to declare other traits as inputs via the
 * `traits: [...]` field.  This creates a dependency graph that must be:
 *   1. Acyclic (no circular dependencies between traits)
 *   2. Reference-safe (no uninitialized / null trait references)
 *
 * These checks run at config-load time — before any training or inference —
 * so failures surface immediately with a clear error, not at runtime.
 */

import { AnyTraitDefinition } from './traitTypes';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export class TraitGraphError extends Error {
  public readonly code: 'TRAIT_REFERENCED_BEFORE_DEFINITION' | 'CYCLE_DETECTED';
  public readonly traitName: string;
  public readonly cyclePath?: string[];

  constructor(
    code: 'TRAIT_REFERENCED_BEFORE_DEFINITION' | 'CYCLE_DETECTED',
    traitName: string,
    cyclePath?: string[]
  ) {
    const msg =
      code === 'CYCLE_DETECTED'
        ? `Cycle detected in trait graph: ${cyclePath?.join(' → ')}`
        : `Trait "${traitName}" referenced before definition — ensure it is declared before the trait that depends on it`;

    super(msg);
    this.code = code;
    this.traitName = traitName;
    this.cyclePath = cyclePath;
    this.name = 'TraitGraphError';
    Object.setPrototypeOf(this, TraitGraphError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk the trait graph depth-first, detecting:
 *  - Null / undefined references (TRAIT_REFERENCED_BEFORE_DEFINITION)
 *  - Cycles (CYCLE_DETECTED)
 *
 * `knownNames` is the set of trait names that have been fully declared
 * (i.e., their `defineTrait` call completed) before the graph check runs.
 */
function visit(
  trait: AnyTraitDefinition,
  knownNames: Set<string>,
  visiting: Set<string>,
  visited: Set<string>,
  path: string[]
): void {
  if (visited.has(trait.name)) return;

  if (visiting.has(trait.name)) {
    throw new TraitGraphError('CYCLE_DETECTED', trait.name, [...path, trait.name]);
  }

  visiting.add(trait.name);
  path.push(trait.name);

  for (const dep of trait.traits ?? []) {
    if (dep === null || dep === undefined || typeof dep !== 'object' || !dep.name) {
      throw new TraitGraphError(
        'TRAIT_REFERENCED_BEFORE_DEFINITION',
        '(unknown)',
      );
    }

    if (!knownNames.has(dep.name)) {
      throw new TraitGraphError('TRAIT_REFERENCED_BEFORE_DEFINITION', dep.name);
    }

    visit(dep, knownNames, visiting, visited, path);
  }

  path.pop();
  visiting.delete(trait.name);
  visited.add(trait.name);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a set of trait definitions for reference safety and acyclicity.
 *
 * Pass all traits that will be used in a `defineConfig` call.
 * Throws `TraitGraphError` on the first violation found.
 *
 * @example
 * ```ts
 * resolveTraitGraph([churnRisk, fraudScore, retentionMessage]);
 * ```
 */
export function resolveTraitGraph(traits: AnyTraitDefinition[]): void {
  // Detect null/undefined entries first — these indicate a trait was passed
  // before its `defineTrait` call completed (e.g., used before declaration).
  for (const trait of traits) {
    if (trait === null || trait === undefined || typeof trait !== 'object') {
      throw new TraitGraphError('TRAIT_REFERENCED_BEFORE_DEFINITION', '(unknown)');
    }
  }

  // Detect duplicate names — each trait must have a unique name in the graph.
  const knownNames = new Set<string>();
  for (const trait of traits) {
    if (knownNames.has(trait.name)) {
      throw new Error(`Duplicate trait name: "${trait.name}". Each trait must have a unique name.`);
    }
    knownNames.add(trait.name);
  }

  const visited = new Set<string>();

  for (const trait of traits) {
    if (!visited.has(trait.name)) {
      visit(trait, knownNames, new Set(), visited, []);
    }
  }
}

/**
 * Return a topologically sorted list of trait definitions (leaves first).
 * This is the training order: dependencies are trained before the traits
 * that consume them.
 *
 * Assumes `resolveTraitGraph` has already been called (no cycles).
 */
export function topologicalSort(traits: AnyTraitDefinition[]): AnyTraitDefinition[] {
  const byName = new Map(traits.map((t) => [t.name, t]));
  const sorted: AnyTraitDefinition[] = [];
  const visited = new Set<string>();

  function dfs(trait: AnyTraitDefinition): void {
    if (visited.has(trait.name)) return;
    for (const dep of trait.traits ?? []) {
      const resolved = byName.get(dep.name);
      if (resolved) dfs(resolved);
    }
    visited.add(trait.name);
    sorted.push(trait);
  }

  for (const trait of traits) {
    dfs(trait);
  }

  return sorted;
}
