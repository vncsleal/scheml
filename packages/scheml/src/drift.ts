/**
 * ScheML Drift Detection
 *
 * Detects when a trained artifact's entity schema has changed since it was
 * compiled, by comparing the stored `schemaHash` with the hash of the current
 * schema for the same entity.
 *
 * Field-level delta (added / removed relative to the artifact's feature list)
 * is computed when caller supplies the current field snapshot.
 */

import type { ArtifactMetadata } from './artifacts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaFieldSnapshot {
  type: string;
  optional: boolean;
}

/** All fields of an entity as seen today, keyed by field name */
export type SchemaSnapshot = Record<string, SchemaFieldSnapshot>;

/**
 * Per-artifact drift result.
 *
 * - `hasDrift: false` → artifact is still in sync with the current schema
 * - `hasDrift: true`  → the stored `schemaHash` no longer matches the computed
 *                       hash for the entity.  `removed` lists artifact feature
 *                       names missing from the current schema (potentially
 *                       breaking at inference time). `added` lists new fields
 *                       the artifact has no knowledge of (non-breaking but may
 *                       indicate a re-train is desirable).
 */
export interface SchemaDelta {
  /** Artifact (signal) name */
  traitName: string;
  /** Hash stored in the artifact metadata */
  storedHash: string;
  /** Hash recomputed from the current schema */
  currentHash: string;
  hasDrift: boolean;
  /**
   * Fields present in the current schema but NOT in the artifact's feature
   * list (schema extended — non-breaking).  Only populated when `hasDrift`
   * is true and a `SchemaSnapshot` was supplied to `checkArtifactDrift`.
   */
  added?: string[];
  /**
   * Feature names the artifact was trained on that no longer exist in the
   * current schema (schema contracted — potentially breaking).  Only populated
   * when `hasDrift` is true and a `SchemaSnapshot` was supplied.
   */
  removed?: string[];
}

// ---------------------------------------------------------------------------
// Feature name extraction
// ---------------------------------------------------------------------------

/**
 * Extract the ordered list of feature names from an artifact's metadata.
 * This is the field list the artifact was trained on (or the context fields
 * for generative traits).
 *
 * Returns an empty array for artifact types that do not embed feature names
 * explicitly (e.g. sequential — the expanded feature list is recomputed at
 * inference time from window aggregations and is not stored separately).
 */
export function extractArtifactFeatureNames(metadata: ArtifactMetadata): string[] {
  switch (metadata.traitType) {
    case 'predictive':
      return metadata.features?.order ?? [];
    case 'anomaly':
      return metadata.featureNames ?? [];
    case 'similarity':
      return metadata.featureNames ?? [];
    case 'generative':
      return metadata.contextFields ?? [];
    case 'sequential':
      // The sequence field is a single raw series; expanded feature names after
      // window aggregation are not stored in metadata.  Return empty — callers
      // may still detect drift via hash comparison.
      return [];
    default: {
      // Exhaustive guard — metadata type will be 'never' here
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

/**
 * Compare a trained artifact's stored schema hash against the hash just
 * computed for the current entity schema.
 *
 * @param metadata        - Artifact metadata loaded from disk
 * @param currentSchemaHash - Hash computed from the current entity's schema
 *                            (via `hashPrismaModelSubset`)
 * @param currentFields   - Optional snapshot of current entity fields (from
 *                          `parseModelSchema`). When provided, field-level
 *                          `added` / `removed` arrays are populated.
 */
export function checkArtifactDrift(
  metadata: ArtifactMetadata,
  currentSchemaHash: string,
  currentFields?: SchemaSnapshot
): SchemaDelta {
  const storedHash = metadata.schemaHash;
  const hasDrift = storedHash !== currentSchemaHash;

  let added: string[] | undefined;
  let removed: string[] | undefined;

  if (hasDrift && currentFields) {
    const artifactFieldSet = new Set(extractArtifactFeatureNames(metadata));
    const currentFieldSet = new Set(Object.keys(currentFields));

    // Fields in current schema not used by the artifact (newly added to schema)
    added = [...currentFieldSet].filter((f) => !artifactFieldSet.has(f));
    // Fields the artifact used that have since been removed from the schema
    removed = [...artifactFieldSet].filter((f) => !currentFieldSet.has(f));
  }

  return {
    traitName: metadata.traitName,
    storedHash,
    currentHash: currentSchemaHash,
    hasDrift,
    added,
    removed,
  };
}
