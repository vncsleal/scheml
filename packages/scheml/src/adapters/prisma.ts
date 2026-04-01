/**
 * Prisma Adapter
 *
 * Implements SchemaReader and DataExtractor for Prisma ORM.
 * The SchemaReader wraps the existing normalizePrismaSchema / hashPrismaModelSubset
 * functions so the training pipeline remains backward-compatible while operating
 * through the common adapter interface.
 *
 * DataExtractor instantiates PrismaClient dynamically from the consuming project's
 * node_modules (via createRequire) rather than from this package — this is necessary
 * because Prisma generates client code that differs per project schema.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import {
  parseModelSchema,
  hashPrismaModelSubset,
  extractModelNames,
} from '../schema';
import type {
  SchemaGraph,
  EntitySchema,
  FieldSchema,
  SchemaReader,
  DataExtractor,
  QueryInterceptor,
  ScheMLAdapter,
  ExtractOptions,
  Row,
  InferenceResult,
} from './interface';
import type { FeatureDependency } from '../types';
import type { PredictionSession } from '../prediction';
import { TTLCache } from '../cache';

// ---------------------------------------------------------------------------
// trait: filter helpers
// ---------------------------------------------------------------------------

/**
 * Test whether a scalar value satisfies a Prisma-style filter condition object.
 * Supports: gt, gte, lt, lte, equals, eq.
 */
function matchesCondition(value: number, condition: Record<string, unknown>): boolean {
  return Object.entries(condition).every(([op, threshold]) => {
    switch (op) {
      case 'gt':     return value > (threshold as number);
      case 'gte':    return value >= (threshold as number);
      case 'lt':     return value < (threshold as number);
      case 'lte':    return value <= (threshold as number);
      case 'equals':
      case 'eq':     return value === threshold;
      default:       return true;
    }
  });
}

// ---------------------------------------------------------------------------
// Prisma → common type mapping
// ---------------------------------------------------------------------------

/** Prisma scalar type names → FeatureDependency.scalarType */
const PRISMA_TYPE_MAP: Record<string, FeatureDependency['scalarType']> = {
  String:   'string',
  Boolean:  'boolean',
  Int:      'number',
  BigInt:   'number',
  Float:    'number',
  Decimal:  'number',
  DateTime: 'date',
};

function mapPrismaType(typeName: string): FeatureDependency['scalarType'] {
  return PRISMA_TYPE_MAP[typeName] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// PrismaSchemaReader
// ---------------------------------------------------------------------------

/**
 * Reads a `.prisma` file and returns the adapter-agnostic SchemaGraph.
 * An instance is re-usable — call readSchema() each time the file changes.
 */
export class PrismaSchemaReader implements SchemaReader {
  async readSchema(source: string): Promise<SchemaGraph> {
    const schemaPath = path.resolve(source);
    const rawSource = fs.readFileSync(schemaPath, 'utf-8');

    const modelNames = extractModelNames(rawSource);
    const entities = new Map<string, EntitySchema>();

    for (const name of modelNames) {
      const prismaFields = parseModelSchema(rawSource, name);
      const fields: Record<string, FieldSchema> = {};

      for (const [fieldName, meta] of Object.entries(prismaFields)) {
        // Strip array brackets (e.g. "String[]" → "String")
        const baseType = meta.type.replace(/\[\]$/, '');
        const isPrimitive = baseType in PRISMA_TYPE_MAP;
        fields[fieldName] = {
          name:       fieldName,
          scalarType: mapPrismaType(baseType),
          nullable:   meta.optional,
          isEnum:     !isPrimitive,
        };
      }

      entities.set(name, { name, fields });
    }

    return { entities, rawSource };
  }

  hashModel(graph: SchemaGraph, modelName: string): string {
    return hashPrismaModelSubset(graph.rawSource, modelName);
  }
}

// ---------------------------------------------------------------------------
// PrismaDataExtractor
// ---------------------------------------------------------------------------

/**
 * Extracts training rows via PrismaClient.
 *
 * PrismaClient is loaded at call-time from the consuming project's node_modules
 * so that the generated type bindings for that project's schema are used.
 * Pass `projectRoot` to override the working directory for the require resolution.
 */
export class PrismaDataExtractor implements DataExtractor {
  private readonly projectRoot: string;
  private client: any = null;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  private getClient(): any {
    if (!this.client) {
      const require = createRequire(
        path.resolve(this.projectRoot, 'node_modules/@prisma/client/package.json')
      );
      const { PrismaClient } = require('@prisma/client');
      this.client = new PrismaClient();
    }
    return this.client;
  }

  async extract(modelName: string, options: ExtractOptions = {}): Promise<Row[]> {
    const client = this.getClient();
    // Prisma delegates are camelCase: "User" → client.user
    const delegateName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    const delegate = client[delegateName];
    if (!delegate || typeof delegate.findMany !== 'function') {
      throw new Error(
        `PrismaClient does not expose model "${modelName}" (looked for client.${delegateName})`
      );
    }

    const query: Record<string, unknown> = {};
    if (options.orderBy) {
      query.orderBy = { [options.orderBy]: 'asc' };
    } else {
      // Default to ID for deterministic ordering (stable train/test splits)
      query.orderBy = { id: 'asc' };
    }
    if (options.where) {
      query.where = options.where;
    }
    if (options.take !== undefined) {
      query.take = options.take;
    }

    return delegate.findMany(query) as Promise<Row[]>;
  }

  async write(
    modelName: string,
    results: InferenceResult[],
    columnName: string = 'schemlPrediction'
  ): Promise<void> {
    const client = this.getClient();
    const delegateName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    const delegate = client[delegateName];
    if (!delegate || typeof delegate.update !== 'function') {
      throw new Error(
        `PrismaClient does not expose model "${modelName}" (looked for client.${delegateName})`
      );
    }

    await Promise.all(
      results.map((r) =>
        delegate.update({
          where: { id: r.entityId },
          data: { [columnName]: r.prediction },
        })
      )
    );
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
    }
  }
}

// ---------------------------------------------------------------------------
// PrismaQueryInterceptor
// ---------------------------------------------------------------------------

/**
 * Extends a PrismaClient instance with computed trait fields via `$extends`.
 * Each registered trait becomes a nullable computed field on the corresponding
 * Prisma model result type.
 *
 * Usage:
 * ```ts
 * const interceptor = new PrismaQueryInterceptor([churnRisk]);
 * const extendedClient = interceptor.extendClient(prisma);
 * const user = await extendedClient.user.findFirst({ where: { id: 1 } });
 * user.churnRisk; // number | null
 * ```
 */
export class PrismaQueryInterceptor implements QueryInterceptor {
  constructor(
    private readonly traits: Array<{
      traitName: string;
      entityName: string;
      featureNames: string[];
      materializedColumn?: string;
      supportsLiveInference?: boolean;
    }>,
    private readonly options: {
      mode?: 'materialized' | 'live' | 'hybrid';
      predictionSession?: PredictionSession;
      cache?: TTLCache<string, number | string | boolean | null>;
      cacheTtlMs?: number;
      materializedColumnsPresent?: boolean;
    } = {}
  ) {}

  extendClient(client: any): any {
    if (typeof client.$extends !== 'function') {
      throw new Error(
        'PrismaQueryInterceptor requires a Prisma Client that supports $extends (Prisma ≥ 4.7)'
      );
    }

    const mode = this.options.mode ?? 'materialized';
    const cache = this.options.cache ?? new TTLCache<string, number | string | boolean | null>(
      this.options.cacheTtlMs ?? 30_000
    );
    const predictionSession = this.options.predictionSession;

    // Prisma result extension format:
    // {
    //   result: {
    //     user: {
    //       churnRisk: { needs: { ... }, compute(row) { ... } }
    //     }
    //   }
    // }
    const resultExtensions: Record<string, Record<string, unknown>> = {};

    for (const trait of this.traits) {
      const modelKey = trait.entityName.charAt(0).toLowerCase() + trait.entityName.slice(1);
      if (!resultExtensions[modelKey]) {
        resultExtensions[modelKey] = {};
      }

      const needs: Record<string, boolean> = { id: true };
      if (mode === 'materialized' || mode === 'hybrid') {
        if (this.options.materializedColumnsPresent) {
          needs[trait.materializedColumn ?? trait.traitName] = true;
        }
      }
      if (mode === 'live' || mode === 'hybrid') {
        for (const featureName of trait.featureNames) {
          needs[featureName] = true;
        }
      }

      resultExtensions[modelKey][trait.traitName] = {
        needs,
        compute: async (row: Record<string, unknown>) => {
          const materializedColumn = trait.materializedColumn ?? trait.traitName;

          if ((mode === 'materialized' || mode === 'hybrid') && this.options.materializedColumnsPresent) {
            const materialized = row[materializedColumn] as number | string | boolean | null | undefined;
            if (materialized !== undefined && materialized !== null) {
              return materialized;
            }
            if (mode === 'materialized') {
              return materialized ?? null;
            }
          }

          if (mode === 'live' || mode === 'hybrid') {
            if (!predictionSession || !trait.supportsLiveInference) {
              return null;
            }

            const cacheKey = `${trait.traitName}:${String(row.id)}`;
            const cached = cache.get(cacheKey);
            if (cached !== undefined) {
              return cached;
            }

            const featureResolvers: Record<string, (entity: any) => any> = {};
            for (const featureName of trait.featureNames) {
              featureResolvers[featureName] = (entity: any) => entity[featureName];
            }

            const prediction = await predictionSession.predict(
              trait.traitName,
              row,
              featureResolvers
            );
            cache.set(cacheKey, prediction.prediction);
            return prediction.prediction;
          }

          return null;
        },
      };
    }

    // Build query extension for `trait:` filter syntax.
    // `findMany({ where: { trait: { churnRisk: { gt: 0.75 } } } })` rewrites
    // the `trait` sub-object into materialized column conditions (materialized /
    // hybrid) or a post-filter on live inference (live).
    const traitBindings = this.traits;
    const interceptorMode = mode;
    const interceptorSession = predictionSession;
    const interceptorCache = cache;
    const materializedPresent = this.options.materializedColumnsPresent;

    const applyFilter = async (
      model: string,
      args: any,
      query: (a: any) => Promise<any>
    ): Promise<any> => {
      if (!args?.where?.trait) {
        return query(args);
      }

      const traitFilter = args.where.trait as Record<string, unknown>;
      const cleanArgs: any = { ...args, where: { ...args.where } };
      delete cleanArgs.where.trait;
      if (Object.keys(cleanArgs.where).length === 0) {
        delete cleanArgs.where;
      }

      const relevant = traitBindings.filter(
        (t) => t.entityName.toLowerCase() === model.toLowerCase()
      );

      if (interceptorMode === 'materialized' || interceptorMode === 'hybrid') {
        if (materializedPresent) {
          for (const [traitName, condition] of Object.entries(traitFilter)) {
            const binding = relevant.find((t) => t.traitName === traitName);
            if (binding) {
              cleanArgs.where = cleanArgs.where ?? {};
              cleanArgs.where[binding.materializedColumn ?? traitName] = condition;
            }
          }
        }
        return query(cleanArgs);
      }

      if (interceptorMode === 'live') {
        const rows: any[] = await query(cleanArgs);
        const filtered: any[] = [];
        for (const row of rows) {
          let passes = true;
          for (const [traitName, condition] of Object.entries(traitFilter)) {
            const binding = relevant.find((t) => t.traitName === traitName);
            if (!binding || !binding.supportsLiveInference || !interceptorSession) {
              continue;
            }
            const cacheKey = `${traitName}:${String(row.id)}`;
            let val = interceptorCache.get(cacheKey);
            if (val === undefined) {
              const resolvers: Record<string, (e: any) => any> = {};
              for (const fn of binding.featureNames) {
                resolvers[fn] = (e: any) => e[fn];
              }
              const pred = await interceptorSession.predict(traitName, row, resolvers);
              val = pred.prediction as number | string | boolean | null;
              interceptorCache.set(cacheKey, val);
            }
            if (typeof val === 'number' && !matchesCondition(val, condition as Record<string, unknown>)) {
              passes = false;
              break;
            }
          }
          if (passes) filtered.push(row);
        }
        return filtered;
      }

      return query(cleanArgs);
    };

    return client.$extends({
      query: {
        $allModels: {
          findMany:          async ({ model, args, query }: any) => applyFilter(model, args, query),
          findFirst:         async ({ model, args, query }: any) => {
            const results = await applyFilter(model, args, query);
            return Array.isArray(results) ? (results[0] ?? null) : results;
          },
          findFirstOrThrow:  async ({ model, args, query }: any) => {
            const results = await applyFilter(model, args, query);
            const first = Array.isArray(results) ? results[0] : results;
            if (first == null) throw new Error(`No ${model} record found matching trait filter`);
            return first;
          },
        },
      },
      result: resultExtensions,
    });
  }
}

// ---------------------------------------------------------------------------
// Prisma adapter factory
// ---------------------------------------------------------------------------

/**
 * Creates a fully wired Prisma adapter for the given project root.
 *
 * @param projectRoot - working directory of the consuming project; used to
 *   locate the generated `@prisma/client` package on disk.
 */
export function createPrismaAdapter(projectRoot: string = process.cwd()): ScheMLAdapter {
  return {
    name:        'prisma',
    reader:      new PrismaSchemaReader(),
    extractor:   new PrismaDataExtractor(projectRoot),
    interceptor: new PrismaQueryInterceptor([]),
  };
}
