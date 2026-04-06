import type { ModelMetadata } from './types';
import type { SchemaGraph, SchemaReader } from './adapters/interface';
import { computeMetadataSchemaHash } from './schemaHash';

export function computeSchemaHashForMetadata(
  graph: SchemaGraph,
  metadata: Pick<ModelMetadata, 'modelName' | 'featureDependencies'> & { entityName?: string },
  reader: SchemaReader
): string {
  return computeMetadataSchemaHash(graph, metadata, reader);
}
