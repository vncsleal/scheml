/**
 * Runtime helper for extending adapter clients with trait fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScheMLConfig } from './defineConfig';
import {
  metadataFileName,
  parseArtifactMetadata,
  isPredictiveArtifact,
  isAnomalyArtifact,
  isTemporalArtifact,
} from './artifacts';
import type { AnyTraitDefinition } from './traitTypes';
import { requireTraitEntityName, resolveConfiguredAdapter, resolveSchemaPath } from './adapterResolution';
import { PredictionSession, type PredictionSessionOptions } from './prediction';
import { TTLCache } from './cache';
import { getMaterializedColumnName } from './materialization';

export interface ExtendClientOptions {
  artifactsDir?: string;
  schemaPath?: string;
  mode?: 'materialized' | 'live';
  cacheTtlMs?: number;
  materializedColumnsPresent?: boolean;
}

export function createPredictionSession(
  config: Pick<ScheMLConfig, 'generativeProvider'>,
  options: PredictionSessionOptions = {}
): PredictionSession {
  return new PredictionSession({
    ...options,
    generativeProvider: options.generativeProvider ?? config.generativeProvider,
  });
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

function resolveLiveFeatureNames(trait: AnyTraitDefinition, metadataPath: string): string[] {
  const content = fs.readFileSync(metadataPath, 'utf-8');
  const metadata = parseArtifactMetadata(JSON.parse(content));

  if (!metadata) {
    throw new Error(`Invalid artifact metadata for live trait ${trait.name}`);
  }

  if (isPredictiveArtifact(metadata)) {
    return metadata.features.order;
  }

  if (isAnomalyArtifact(metadata)) {
    return metadata.featureNames;
  }

  if (isTemporalArtifact(metadata)) {
    const featureOrder = metadata.features?.order;
    if (!featureOrder || featureOrder.length === 0) {
      throw new Error(
        `Temporal live trait ${trait.name} is missing compiled feature metadata. Retrain the trait artifacts before using live mode.`
      );
    }

    return featureOrder;
  }

  return featureNamesFor(trait);
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
  const liveFeatureNamesByTrait = new Map<string, string[]>();
  if (mode === 'live') {
    if (!schemaPath && typeof config.adapter === 'string') {
      throw new Error(
        'schemaPath is required for live mode. ' +
        'Set schema in scheml.config.ts or pass options.schemaPath to extendClient().'
      );
    }
    predictionSession = createPredictionSession(config);
    const missingArtifacts: string[] = [];

    for (const trait of traits) {
      requireTraitEntityName(trait, adapterName);
      if (!supportsLiveInference(trait)) continue;

      const metadataPath = path.join(artifactsDir, metadataFileName(trait.name));
      if (!fs.existsSync(metadataPath)) {
        missingArtifacts.push(trait.name);
        continue;
      }
      await predictionSession.loadTrait(trait.name, { artifactsDir, schemaPath, adapter });
      liveFeatureNamesByTrait.set(trait.name, resolveLiveFeatureNames(trait, metadataPath));
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
          featureNames: liveFeatureNamesByTrait.get(trait.name) ?? featureNamesFor(trait),
          materializedColumn: getMaterializedColumnName(trait),
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
