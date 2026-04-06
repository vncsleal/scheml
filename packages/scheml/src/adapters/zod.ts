/**
 * Zod Adapter
 *
 * Implements SchemaReader for Zod schemas.
 * Zod is a pure validation / type-inference library with no data-access layer,
 * so only SchemaReader is supported (no DataExtractor or QueryInterceptor).
 *
 * The reader traverses a ZodObject shape to produce the adapter-agnostic
 * SchemaGraph. It works at runtime and therefore does not require any build
 * step or code-generation.
 *
 * Usage:
 * ```ts
 * import { z } from 'zod';
 * import { ZodSchemaReader } from '@vncsleal/scheml/adapters/zod';
 *
 * const UserSchema = z.object({ id: z.number(), email: z.string(), active: z.boolean() });
 * const reader = new ZodSchemaReader({ User: UserSchema });
 * const graph = await reader.readSchema('User');
 * ```
 */

import * as crypto from 'crypto';
import type {
  SchemaGraph,
  EntitySchema,
  FieldSchema,
  SchemaReader,
  ScheMLAdapter,
} from './interface';
import type { FeatureDependency } from '../types';

// ---------------------------------------------------------------------------
// Zod type introspection — kept minimal to avoid a hard dependency on zod.
// We introspect via the _def property which is part of Zod's public API.
// ---------------------------------------------------------------------------

type ZodTypeDef = { typeName: string; [key: string]: unknown };
type ZodTypeAny = { _def: ZodTypeDef; isOptional?: () => boolean };
type ZodObjectShape = Record<string, ZodTypeAny>;
type ZodObjectLike = { _def: { typeName: 'ZodObject'; shape: () => ZodObjectShape } };
type ZodWrappedTypeDef = ZodTypeDef & { innerType?: ZodTypeAny };

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isZodTypeDef(value: unknown): value is ZodTypeDef {
  return isObjectRecord(value) && typeof value.typeName === 'string';
}

function getInnerWrappedType(typeDef: ZodTypeDef): ZodTypeAny | null {
  const wrapped = typeDef as ZodWrappedTypeDef;
  return wrapped.innerType ?? null;
}

function isZodObject(schema: unknown): schema is ZodObjectLike {
  if (!isObjectRecord(schema) || !('_def' in schema) || !isZodTypeDef(schema._def)) {
    return false;
  }

  return schema._def.typeName === 'ZodObject';
}

/** Resolve the innermost type of ZodOptional / ZodNullable / ZodDefault wrappers */
function unwrapZodType(zodType: ZodTypeAny): { inner: ZodTypeAny; nullable: boolean } {
  let inner = zodType;
  let nullable = false;
  let keepUnwrapping = true;

  while (keepUnwrapping) {
    const typeName: string = inner._def.typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      nullable = true;
      const nested = getInnerWrappedType(inner._def);
      if (!nested) {
        keepUnwrapping = false;
        continue;
      }
      inner = nested;
    } else if (typeName === 'ZodDefault') {
      const nested = getInnerWrappedType(inner._def);
      if (!nested) {
        keepUnwrapping = false;
        continue;
      }
      inner = nested;
    } else {
      keepUnwrapping = false;
    }
  }

  return { inner, nullable };
}

/** Map a Zod type name to the common scalarType */
function mapZodType(typeName: string): FeatureDependency['scalarType'] {
  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
    case 'ZodBigInt':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodDate':
      return 'date';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// ZodSchemaReader
// ---------------------------------------------------------------------------

/**
 * Reads Zod schemas passed as a name→ZodObject map.
 *
 * The `source` argument to `readSchema` is interpreted as a JSON string
 * containing an object of `{ [entityName]: zodSchemaRef }`, but because
 * Zod schemas are live objects (not serialisable) the map is normally
 * provided directly to the constructor.
 *
 * @param schemas - Record mapping entity names to ZodObject schemas.
 *   This is the primary way to use the adapter.
 */
export class ZodSchemaReader implements SchemaReader {
  constructor(private readonly schemas: Record<string, ZodTypeAny> = {}) {}

  async readSchema(_source: string): Promise<SchemaGraph> {
    // _source is ignored when schemas were provided to the constructor.
    return this._buildGraph(this.schemas, _source);
  }

  /**
   * Build a SchemaGraph from a Zod schema map.
   * Can also be called directly without going through readSchema.
   */
  buildGraph(schemas: Record<string, ZodTypeAny>): SchemaGraph {
    return this._buildGraph(schemas, '');
  }

  private _buildGraph(schemas: Record<string, ZodTypeAny>, rawSource: string): SchemaGraph {
    const entities = new Map<string, EntitySchema>();

    for (const [entityName, schema] of Object.entries(schemas)) {
      if (!isZodObject(schema)) continue;

      const shape = schema._def.shape();
      const fields: Record<string, FieldSchema> = {};

      for (const [fieldName, fieldType] of Object.entries(shape)) {
        const { inner, nullable } = unwrapZodType(fieldType);
        const typeName = inner._def.typeName;
        fields[fieldName] = {
          name:       fieldName,
          scalarType: mapZodType(typeName),
          nullable,
          isEnum:     typeName === 'ZodEnum' || typeName === 'ZodNativeEnum',
        };
      }

      entities.set(entityName, { name: entityName, fields });
    }

    return { entities, rawSource };
  }

  hashModel(graph: SchemaGraph, modelName: string): string {
    const entity = graph.entities.get(modelName);
    if (!entity) {
      // Fall back to hashing all entities if model is unknown
      return crypto
        .createHash('sha256')
        .update(JSON.stringify(Object.fromEntries(graph.entities)), 'utf-8')
        .digest('hex');
    }

    // Deterministic hash: sort fields alphabetically, serialise as JSON
    const sortedFields = Object.fromEntries(
      Object.entries(entity.fields).sort(([a], [b]) => a.localeCompare(b))
    );
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ name: modelName, fields: sortedFields }), 'utf-8')
      .digest('hex');
  }
}

// ---------------------------------------------------------------------------
// Zod adapter factory
// ---------------------------------------------------------------------------

/**
 * Creates a Zod adapter from a map of entity name → ZodObject schema.
 * Only `reader` is populated — Zod has no data-access layer.
 */
export function createZodAdapter(
  schemas: Record<string, ZodTypeAny> = {}
): ScheMLAdapter {
  return {
    name:   'zod',
    reader: new ZodSchemaReader(schemas),
  };
}
