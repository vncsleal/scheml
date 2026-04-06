/**
 * ScheML Generative Trait — Compile-time validation and artifact compilation.
 *
 * Generative traits are not ML inference — they are structured prompt execution.
 * `scheml train` validates the trait definition and writes a compiled prompt
 * template artifact (JSON). At inference, `PredictionSession.predictGenerative`
 * detects the output schema shape and calls the configured AI provider via AI SDK v5+.
 *
 * No Python backend is involved for generative traits.
 */

import { GenerativeTrait } from './traitTypes';
import { ModelDefinitionError } from './errors';
import type { GenerativeArtifactMetadata } from './artifacts';

// ---------------------------------------------------------------------------
// Output schema shape detection
// ---------------------------------------------------------------------------

export type OutputSchemaShape = 'text' | 'choice' | 'object';

export interface DetectedOutputSchema {
  shape: OutputSchemaShape;
  /** Populated only when shape === 'choice' */
  choiceOptions?: string[];
}

type ZodLikeRuntime = {
  _def?: {
    typeName?: string;
    values?: string[] | Record<string, string>;
  };
};

function isZodLikeRuntime(value: unknown): value is ZodLikeRuntime {
  return typeof value === 'object' && value !== null;
}

/**
 * Detects the AI SDK inference strategy from a Zod schema at runtime.
 * Uses duck-typing on Zod's internal `_def.typeName` to avoid a hard runtime
 * dependency on the `zod` package in ScheML itself.
 *
 * - `z.string()` / no schema       → `'text'`   → `generateText`
 * - `z.enum([...])`                → `'choice'` → `generateObject({ output: 'enum', ... })`
 * - `z.object({...})`              → `'object'` → `generateObject({ schema, ... })`
 */
export function detectOutputSchemaShape(outputSchema: unknown): DetectedOutputSchema {
  if (!isZodLikeRuntime(outputSchema)) {
    return { shape: 'text' };
  }

  const typeName = outputSchema._def?.typeName;

  if (!typeName || typeName === 'ZodString' || typeName === 'ZodAny') {
    return { shape: 'text' };
  }

  if (typeName === 'ZodEnum') {
    const rawValues = outputSchema._def?.values;
    const choiceOptions: string[] = Array.isArray(rawValues)
      ? rawValues
      : rawValues && typeof rawValues === 'object'
        ? Object.values(rawValues)
        : [];
    return { shape: 'choice', choiceOptions };
  }

  if (typeName === 'ZodObject') {
    return { shape: 'object' };
  }

  // Default to text for any other Zod type (ZodUnion, ZodOptional, etc.)
  return { shape: 'text' };
}

// ---------------------------------------------------------------------------
// Compile-time validation
// ---------------------------------------------------------------------------

/**
 * Validate a generative trait definition at compile time.
 * @param trait - The generative trait definition.
 * @param availableFields - Set of field names available on the entity schema.
 * @throws {ModelDefinitionError} if validation fails.
 */
export function validateGenerativeTrait(
  trait: GenerativeTrait,
  availableFields: Set<string>
): void {
  if (!trait.prompt || !trait.prompt.trim()) {
    throw new ModelDefinitionError(trait.name, 'Generative trait prompt must not be empty');
  }

  for (const field of trait.context) {
    if (!availableFields.has(field)) {
      throw new ModelDefinitionError(
        trait.name,
        `Context field "${field}" not found in entity schema. Available: ${[...availableFields].join(', ')}`
      );
    }
  }

  if (trait.outputSchema !== undefined && trait.outputSchema !== null) {
    const detected = detectOutputSchemaShape(trait.outputSchema);
    if (
      detected.shape === 'choice' &&
      (!detected.choiceOptions || detected.choiceOptions.length === 0)
    ) {
      throw new ModelDefinitionError(
        trait.name,
        `Generative trait uses z.enum() outputSchema but no options were found`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Artifact compilation
// ---------------------------------------------------------------------------

/**
 * Compile a validated generative trait into an artifact metadata object.
 * The caller is responsible for writing this to disk as `<traitName>.metadata.json`.
 *
 * @param trait - Validated generative trait definition.
 * @param schemaHash - Adapter-agnostic hash of the entity schema subset.
 * @param version - ScheML package version at compile time.
 */
export function compileGenerativeTrait(
  trait: GenerativeTrait,
  schemaHash: string,
  version: string
): GenerativeArtifactMetadata {
  const detected = detectOutputSchemaShape(trait.outputSchema);

  return {
    traitType: 'generative',
    artifactFormat: 'json',
    traitName: trait.name,
    schemaHash,
    compiledAt: new Date().toISOString(),
    version,
    metadataSchemaVersion: '1.0.0',
    contextFields: [...trait.context],
    promptTemplate: trait.prompt,
    outputSchemaShape: detected.shape,
    choiceOptions: detected.choiceOptions,
  };
}
