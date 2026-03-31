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

  async write(modelName: string, results: InferenceResult[]): Promise<void> {
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
          data:  { schemlPrediction: r.prediction },
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
  constructor(private readonly traitNames: string[]) {}

  extendClient(client: any): any {
    if (typeof client.$extends !== 'function') {
      throw new Error(
        'PrismaQueryInterceptor requires a Prisma Client that supports $extends (Prisma ≥ 4.7)'
      );
    }

    // Build a `result` extension layer for every registered trait name.
    // The computed field returns null by default — the actual prediction is
    // populated at `scheml materialize` time or by a runtime inference session.
    const resultExtensions: Record<string, Record<string, unknown>> = {};
    for (const traitName of this.traitNames) {
      // Trait names are camelCase; Prisma result extension keys must also match the model name.
      // We cannot know the model name here so the consumer registers per-model.
      // This interceptor is a placeholder — full per-model registration happens in Phase 8.
      resultExtensions[traitName] = {
        needs: {},
        compute: () => null,
      };
    }

    return client.$extends({ result: resultExtensions });
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
