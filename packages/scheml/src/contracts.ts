import type { FeatureDependency, ModelDefinition, ModelMetadata, TaskType } from './types';
import type { SchemaGraph, SchemaReader } from './adapters/interface';
import { ModelDefinitionError } from './errors';

const SUPPORTED_TASK_TYPES = new Set<TaskType>([
  'regression',
  'binary_classification',
  'multiclass_classification',
]);

const SUPPORTED_ALGORITHMS = new Set(['automl', 'linear', 'tree', 'forest', 'gbm']);

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

function assertFiniteNumber(
  modelName: string,
  algorithmName: string,
  parameterName: string,
  value: unknown
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ModelDefinitionError(
      modelName,
      `Algorithm "${algorithmName}" requires "${parameterName}" to be a finite number`
    );
  }
  return value;
}

function assertPositiveInteger(
  modelName: string,
  algorithmName: string,
  parameterName: string,
  value: unknown,
  minimum: number
): void {
  const numericValue = assertFiniteNumber(modelName, algorithmName, parameterName, value);
  if (!Number.isInteger(numericValue) || numericValue < minimum) {
    throw new ModelDefinitionError(
      modelName,
      `Algorithm "${algorithmName}" requires "${parameterName}" to be an integer >= ${minimum}`
    );
  }
}

function assertBoolean(
  modelName: string,
  algorithmName: string,
  parameterName: string,
  value: unknown
): void {
  if (typeof value !== 'boolean') {
    throw new ModelDefinitionError(
      modelName,
      `Algorithm "${algorithmName}" requires "${parameterName}" to be a boolean`
    );
  }
}

function validateHyperparameters(
  model: ModelDefinition,
  algorithmName: string,
  taskType: TaskType
): void {
  const hyperparameters = model.algorithm?.hyperparameters ?? {};
  const parameterEntries = Object.entries(hyperparameters);

  if (algorithmName === 'automl') {
    if (parameterEntries.length > 0) {
      throw new ModelDefinitionError(
        model.name,
        'AutoML does not currently accept algorithm hyperparameters. Remove "algorithm.hyperparameters" or choose an explicit algorithm override.'
      );
    }
    return;
  }

  const allowedByAlgorithm: Record<string, string[]> = {
    linear:
      taskType === 'regression'
        ? ['fitIntercept']
        : ['fitIntercept', 'maxIter', 'C'],
    tree: ['maxDepth', 'minSamplesSplit', 'minSamplesLeaf'],
    forest: ['nEstimators', 'maxDepth', 'minSamplesSplit', 'minSamplesLeaf'],
    gbm: ['nEstimators', 'learningRate', 'maxDepth', 'minSamplesSplit', 'minSamplesLeaf', 'subsample'],
  };

  const allowed = new Set(allowedByAlgorithm[algorithmName] ?? []);

  for (const [parameterName, value] of parameterEntries) {
    if (!allowed.has(parameterName)) {
      const supportedList = Array.from(allowed).sort().join(', ') || 'none';
      throw new ModelDefinitionError(
        model.name,
        `Unsupported hyperparameter "${parameterName}" for algorithm "${algorithmName}". Supported parameters: ${supportedList}.`
      );
    }

    switch (parameterName) {
      case 'fitIntercept':
        assertBoolean(model.name, algorithmName, parameterName, value);
        break;
      case 'nEstimators':
      case 'maxIter':
      case 'maxDepth':
        assertPositiveInteger(model.name, algorithmName, parameterName, value, 1);
        break;
      case 'minSamplesSplit':
        assertPositiveInteger(model.name, algorithmName, parameterName, value, 2);
        break;
      case 'minSamplesLeaf':
        assertPositiveInteger(model.name, algorithmName, parameterName, value, 1);
        break;
      case 'C':
      case 'learningRate': {
        const numericValue = assertFiniteNumber(model.name, algorithmName, parameterName, value);
        if (numericValue <= 0) {
          throw new ModelDefinitionError(
            model.name,
            `Algorithm "${algorithmName}" requires "${parameterName}" to be > 0`
          );
        }
        break;
      }
      case 'subsample': {
        const numericValue = assertFiniteNumber(model.name, algorithmName, parameterName, value);
        if (numericValue <= 0 || numericValue > 1) {
          throw new ModelDefinitionError(
            model.name,
            'Algorithm "gbm" requires "subsample" to be > 0 and <= 1'
          );
        }
        break;
      }
    }
  }
}

export function validateTrainingModelDefinition(model: ModelDefinition): void {
  // Validate name: must be safe for use in file paths and CLI args.
  // Prevents path traversal (e.g. '../../etc/passwd') in artifact file naming.
  if (!/^[a-zA-Z0-9_-]+$/.test(model.name)) {
    throw new ModelDefinitionError(
      model.name,
      `Invalid model name "${model.name}". Names must contain only letters, numbers, underscores, and hyphens.`
    );
  }

  if (!SUPPORTED_TASK_TYPES.has(model.output.taskType)) {
    throw new ModelDefinitionError(
      model.name,
      `Unsupported task type "${String(model.output.taskType)}"`
    );
  }

  const algorithmName = model.algorithm?.name ?? 'automl';
  const supportedAlgorithmsList =
    Array.from(SUPPORTED_ALGORITHMS).sort().join(', ') || 'none';
  if (!SUPPORTED_ALGORITHMS.has(algorithmName)) {
    throw new ModelDefinitionError(
      model.name,
      `Unsupported algorithm "${algorithmName}". Supported algorithms: ${supportedAlgorithmsList}.`
    );
  }

  validateHyperparameters(model, algorithmName, model.output.taskType);
}
