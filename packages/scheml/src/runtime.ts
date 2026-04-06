/**
 * Runtime helper for extending adapter clients with trait fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScheMLConfig } from './defineConfig';
import type { AnyTraitDefinition } from './traitTypes';
import { requireTraitEntityName, resolveConfiguredAdapter, resolveSchemaPath } from './adapterResolution';
import { PredictionSession } from './prediction';
import { TTLCache } from './cache';

export interface ExtendClientOptions {
  artifactsDir?: string;
  schemaPath?: string;
  mode?: 'materialized' | 'live';
  cacheTtlMs?: number;
  materializedColumnsPresent?: boolean;
}

function getTraits(config: ScheMLConfig): AnyTraitDefinition[] {
  return (config.traits ?? []) as AnyTraitDefinition[];
}

function featureNamesFor(trait: AnyTraitDefinition): string[] {
  if (trait.type === 'predictive') return trait.features;
  if (trait.type === 'anomaly') return trait.baseline;
  if (trait.type === 'temporal') return [trait.sequence];
  return [];
}

function supportsLiveInference(trait: AnyTraitDefinition): boolean {
  return trait.type === 'predictive' || trait.type === 'temporal' || trait.type === 'anomaly';
}

/**
 * Extend an adapter client with trait fields.
 *
 * - materialized mode: reads trait value from materialized DB columns
 * - live mode: computes trait values on access via inference + TTL cache
 */
export async function extendClient(
  client: unknown,
  config: ScheMLConfig,
  options: ExtendClientOptions = {}
): Promise<unknown> {
  const rawSchemaPath = resolveSchemaPath(config.schema, options.schemaPath);
  const schemaPath = rawSchemaPath ? path.resolve(rawSchemaPath) : undefined;
  const adapter = resolveConfiguredAdapter(config.adapter);
  const adapterName = adapter.name;
  if (!adapter.createInterceptor) {
    throw new Error(
      `Adapter "${adapter.name}" does not support extendClient. ` +
      'Only adapters that provide createInterceptor can extend clients.'
    );
  }

  const traits = getTraits(config);
  if (!traits.length) {
    return client;
  }

  const mode = options.mode ?? 'materialized';
  const artifactsDir = path.resolve(options.artifactsDir ?? path.resolve(process.cwd(), '.scheml'));

  let predictionSession: PredictionSession | undefined;
  if (mode === 'live') {
    if (!schemaPath && typeof config.adapter === 'string') {
      throw new Error(
        'schemaPath is required for live mode. ' +
        'Set schema in scheml.config.ts or pass options.schemaPath to extendClient().'
      );
    }
    predictionSession = new PredictionSession();
    const missingArtifacts: string[] = [];

    for (const trait of traits) {
      requireTraitEntityName(trait, adapterName);
      if (!supportsLiveInference(trait)) continue;

      const metadataPath = path.join(artifactsDir, `${trait.name}.metadata.json`);
      if (!fs.existsSync(metadataPath)) {
        missingArtifacts.push(trait.name);
        continue;
      }
      await predictionSession.loadTrait(trait.name, { artifactsDir, schemaPath, adapter });
    }

    if (missingArtifacts.length > 0) {
      throw new Error(
        `Live extendClient requires trained artifacts for all live traits. Missing metadata for: ${missingArtifacts.join(', ')}`
      );
    }
  }

  const interceptor = adapter.createInterceptor(
    traits.map((trait) => {
        return {
          traitName: trait.name,
          entityName: requireTraitEntityName(trait, adapterName),
          featureNames: featureNamesFor(trait),
          materializedColumn: trait.name,
          supportsLiveInference: supportsLiveInference(trait),
        };
      }) as Array<{
      traitName: string;
      entityName: string;
      featureNames: string[];
      materializedColumn?: string;
      supportsLiveInference?: boolean;
    }>,
    {
      mode,
      predictionSession,
      cache: new TTLCache<string, number | string | boolean | null>(options.cacheTtlMs ?? 30_000),
      cacheTtlMs: options.cacheTtlMs,
      materializedColumnsPresent: options.materializedColumnsPresent ?? (mode !== 'live'),
    }
  );

  return interceptor.extendClient(client);
}
