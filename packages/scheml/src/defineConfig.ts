/**
 * ScheML configuration factory.
 *
 * `defineConfig` is a typed pass-through that gives editors type completions
 * for scheml.config.ts exports and makes the project configuration explicit.
 *
 * @example
 * ```ts
 * // scheml.config.ts
 * import { defineConfig, defineTrait } from '@vncsleal/scheml';
 * import { openai } from '@ai-sdk/openai';
 *
 * const churnRisk = defineTrait(users, {
 *   type: 'predictive',
 *   name: 'churnRisk',
 *   target: 'churned',
 *   features: ['lastLoginAt', 'totalPurchases', 'planTier'],
 * });
 *
 * export default defineConfig({
 *   adapter: 'prisma',
 *   generativeProvider: openai('gpt-4o'),
 *   traits: [churnRisk],
 * });
 * ```
 */

import type { AnyTraitDefinition } from './traitTypes';

/**
 * ScheML project configuration.
 */
export interface ScheMLConfig {
  /**
   * Adapter to use for data extraction and schema reading.
   * Pass `'prisma'`, `'drizzle'`, `'zod'`, or a custom adapter instance.
   * If omitted, the adapter is inferred from the `schema` file extension.
   */
  adapter?: string | Record<string, unknown>;

  /**
   * Path to the schema source file.
   * Required unless passed via the `--schema` CLI flag on every command.
   *
   * @example
   * ```ts
   * // Prisma
   * schema: './prisma/schema.prisma'
   * // Drizzle
   * schema: './src/db/schema.ts'
   * ```
   */
  schema?: string;

  /**
   * AI provider for generative traits.
   * Must satisfy the `LanguageModel` interface from the `ai` package (Vercel AI SDK v5+).
   * ScheML does not import the `ai` package directly — any conformant object works.
   *
   * @example
   * ```ts
   * import { openai } from '@ai-sdk/openai';
   * generativeProvider: openai('gpt-4o')
   * ```
   */
  generativeProvider?: unknown;

  /**
   * Trait definitions to compile and train.
   * Alternatively, export them as named exports from `scheml.config.ts` —
   * both approaches work.
   */
  traits?: AnyTraitDefinition[];
}

/**
 * Define the ScheML project configuration with full type completions.
 * Returns the configuration object unchanged — this is a typed no-op wrapper.
 */
export function defineConfig(config: ScheMLConfig): ScheMLConfig {
  return config;
}
