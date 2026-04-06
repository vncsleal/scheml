import type { FeatureDependency, ModelMetadata } from './types';
import type { SchemaGraph, SchemaReader } from './adapters/interface';

export function computeSchemaHashForMetadata(
  graph: SchemaGraph,
  metadata: Pick<ModelMetadata, 'modelName' | 'featureDependencies'> & { entityName?: string },
  reader: SchemaReader
): string {
  if (metadata.entityName) {
    return reader.hashModel(graph, metadata.entityName);
  }
  const entityName =
    metadata.featureDependencies?.find((dep: FeatureDependency) => dep.modelName)?.modelName ||
    metadata.modelName;
  return reader.hashModel(graph, entityName);
}
