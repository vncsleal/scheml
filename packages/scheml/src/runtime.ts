/**
 * Runtime helper for extending adapter clients with trait fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScheMlConfig } from './defineConfig';
import type { AnyTraitDefinition } from './traitTypes';
import { PredictionSession } from './prediction';
import { getAdapter } from './adapters';
import { TTLCache } from './cache';

export interface ExtendClientOptions {
  artifactsDir?: string;
  schemaPath?: string;
  mode?: 'materialized' | 'live' | 'hybrid';
  cacheTtlMs?: number;
  materializedColumnsPresent?: boolean;
}

function getTraits(config: ScheMlConfig): AnyTraitDefinition[] {
  return (config.traits ?? []) as AnyTraitDefinition[];
}

function entityNameFor(trait: AnyTraitDefinition): string | null {
  return typeof (trait as any).entity === 'string' ? (trait as any).entity : null;
}

function featureNamesFor(trait: AnyTraitDefinition): string[] {
  if (trait.type === 'predictive') return trait.features;
  if (trait.type === 'sequential') return [trait.sequence];
  return [];
}

/**
 * Extend a Prisma client with trait fields.
 *
 * - materialized mode: reads trait value from materialized DB columns
 * - live mode: computes trait values on access via ONNX inference + TTL cache
 * - hybrid mode: materialized first, live fallback
 */
export async function extendClient(
  client: unknown,
  config: ScheMlConfig,
  options: ExtendClientOptions = {}
): Promise<unknown> {
  const adapterName = typeof config.adapter === 'string' ? config.adapter : 'prisma';
  const adapter = getAdapter(adapterName);
  if (!adapter.createInterceptor) {
    throw new Error(
      `Adapter "${adapter.name}" does not support extendClient. ` +
      `Only adapters that provide createInterceptor (e.g. "prisma") can extend clients.`
    );
  }

  const traits = getTraits(config);
  if (!traits.length) {
    return client;
  }

  const mode = options.mode ?? 'materialized';
  const artifactsDir = path.resolve(options.artifactsDir ?? path.resolve(process.cwd(), '.scheml'));

  let predictionSession: PredictionSession | undefined;
  if (mode === 'live' || mode === 'hybrid') {
    if (!options.schemaPath) {
      throw new Error(
        'schemaPath is required in ExtendClientOptions when using live or hybrid mode. ' +
        'Set schema in scheml.config.ts or pass options.schemaPath to extendClient().'
      );
    }
    const schemaPath = path.resolve(options.schemaPath);
    const graph = await adapter.reader.readSchema(schemaPath);
    predictionSession = new PredictionSession();

    for (const trait of traits) {
      const entityName = entityNameFor(trait);
      if (!entityName) continue;
      if (trait.type !== 'predictive' && trait.type !== 'sequential') continue;

      const metadataPath = path.join(artifactsDir, `${trait.name}.metadata.json`);
      const onnxPath = path.join(artifactsDir, `${trait.name}.onnx`);
      if (!fs.existsSync(metadataPath) || !fs.existsSync(onnxPath)) {
        continue;
      }

      const schemaHash = adapter.reader.hashModel(graph, entityName);
      await predictionSession.initializeModel(metadataPath, onnxPath, schemaHash);
    }
  }

  const interceptor = adapter.createInterceptor(
    traits
      .map((trait) => {
        const entityName = entityNameFor(trait);
        if (!entityName) return null;
        return {
          traitName: trait.name,
          entityName,
          featureNames: featureNamesFor(trait),
          materializedColumn: trait.name,
          supportsLiveInference: trait.type === 'predictive' || trait.type === 'sequential',
        };
      })
      .filter(Boolean) as Array<{
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
