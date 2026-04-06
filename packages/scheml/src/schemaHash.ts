import * as crypto from 'crypto';
import type { FeatureDependency, ModelMetadata } from './types';
import type { SchemaGraph, SchemaReader, EntitySchema, FieldSchema } from './adapters/interface';

export interface SchemaHashComparison {
  valid: boolean;
  expectedHash: string;
  actualHash: string;
}

type MetadataSchemaReference = Pick<ModelMetadata, 'modelName' | 'featureDependencies'> & {
  entityName?: string;
};

function sortFieldEntries(fields: Record<string, FieldSchema>): Array<[string, FieldSchema]> {
  return Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));
}

function canonicalizeEntity(entity: EntitySchema): Record<string, unknown> {
  return {
    name: entity.name,
    fields: sortFieldEntries(entity.fields).map(([fieldName, field]) => ({
      fieldName,
      scalarType: field.scalarType,
      nullable: field.nullable,
      isEnum: field.isEnum,
    })),
  };
}

function stableHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value), 'utf-8')
    .digest('hex');
}

export function hashSchemaGraph(graph: SchemaGraph): string {
  const entities = Array.from(graph.entities.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(canonicalizeEntity);

  return stableHash({ entities });
}

export function hashSchemaGraphEntity(graph: SchemaGraph, entityName: string): string {
  const entity = graph.entities.get(entityName);
  if (!entity) {
    return hashSchemaGraph(graph);
  }

  return stableHash(canonicalizeEntity(entity));
}

export function hashSchemaEntity(
  graph: SchemaGraph,
  entityName: string,
  reader?: SchemaReader,
): string {
  return reader ? reader.hashModel(graph, entityName) : hashSchemaGraphEntity(graph, entityName);
}

export async function hashSchemaSource(
  source: string,
  reader: SchemaReader,
  entityName?: string,
): Promise<string> {
  const graph = await reader.readSchema(source);
  return entityName ? hashSchemaEntity(graph, entityName, reader) : hashSchemaGraph(graph);
}

export function resolveSchemaEntityName(metadata: MetadataSchemaReference): string {
  if (metadata.entityName) {
    return metadata.entityName;
  }

  const dependencyEntityName = metadata.featureDependencies?.find(
    (dep: FeatureDependency) => dep.modelName,
  )?.modelName;

  return dependencyEntityName || metadata.modelName;
}

export function computeMetadataSchemaHash(
  graph: SchemaGraph,
  metadata: MetadataSchemaReference,
  reader: SchemaReader,
): string {
  return hashSchemaEntity(graph, resolveSchemaEntityName(metadata), reader);
}

export function compareSchemaHashes(expected: string, actual: string): SchemaHashComparison {
  return {
    valid: expected === actual,
    expectedHash: expected,
    actualHash: actual,
  };
}
