/**
 * Runtime helper for extending adapter clients with trait fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScheMLConfig } from './defineConfig';
import type { AnyTraitDefinition } from './traitTypes';
import { PredictionSession } from './prediction';
import { getAdapter, inferAdapterFromSchema } from './adapters';
import { TTLCache } from './cache';

export interface ExtendClientOptions {
  artifactsDir?: string;
  schemaPath?: string;
  mode?: 'materialized' | 'live' | 'hybrid';
  cacheTtlMs?: number;
  materializedColumnsPresent?: boolean;
}

function getTraits(config: ScheMLConfig): AnyTraitDefinition[] {
  return (config.traits ?? []) as AnyTraitDefinition[];
}

function entityNameFor(trait: AnyTraitDefinition): string | null {
  return typeof (trait as any).entity === 'string' ? (trait as any).entity : null;
}

function featureNamesFor(trait: AnyTraitDefinition): string[] {
  if (trait.type === 'predictive') return trait.features;
  if (trait.type === 'temporal') return [trait.sequence];
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
  config: ScheMLConfig,
  options: ExtendClientOptions = {}
): Promise<unknown> {
  const rawSchemaPath = options.schemaPath ?? config.schema;
  const adapterName = typeof config.adapter === 'string'
    ? config.adapter
    : rawSchemaPath
      ? inferAdapterFromSchema(rawSchemaPath) ?? (() => {
          throw new Error(
            `Cannot infer adapter from schema path "${rawSchemaPath}". ` +
            `Set adapter in your ScheMLConfig (e.g. adapter: 'prisma').`
          );
        })()
      : (() => {
          throw new Error(
            'adapter is required in ScheMLConfig. ' +
            `Set adapter (e.g. adapter: 'prisma') or set schema so the adapter can be inferred.`
          );
        })();
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
    const rawSchemaPath = options.schemaPath ?? config.schema;
    if (!rawSchemaPath) {
      throw new Error(
        'schemaPath is required for live or hybrid mode. ' +
        'Set schema in scheml.config.ts or pass options.schemaPath to extendClient().'
      );
    }
    const schemaPath = path.resolve(rawSchemaPath);
    const graph = await adapter.reader.readSchema(schemaPath);
    predictionSession = new PredictionSession();

    for (const trait of traits) {
      const entityName = entityNameFor(trait);
      if (!entityName) continue;
      if (trait.type !== 'predictive' && trait.type !== 'temporal') continue;

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
          supportsLiveInference: trait.type === 'predictive' || trait.type === 'temporal',
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
