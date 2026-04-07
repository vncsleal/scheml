import type { AnyTraitDefinition } from './traitTypes';

/**
 * Resolve the persisted database column used for materialized trait values.
 *
 * Industry-standard convention: the trait identifier is the stable contract
 * across migration, write-back, and runtime reads. `output.field` remains part
 * of the model artifact contract, but it does not rename the persisted trait
 * column.
 */
export function getMaterializedColumnName(trait: AnyTraitDefinition): string {
  return trait.name;
}