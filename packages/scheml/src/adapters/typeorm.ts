/**
 * TypeORM Adapter
 *
 * Implements SchemaReader, DataExtractor, and runtime trait interception for TypeORM.
 * The adapter expects the user's schema source to export a TypeORM DataSource
 * instance (commonly `AppDataSource`, `dataSource`, or a default export).
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createJiti } from 'jiti';
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

type TypeOrmColumnMetadataLike = {
  propertyName: string;
  type?: unknown;
  isNullable?: boolean;
  enum?: unknown[] | Record<string, unknown>;
};

type TypeOrmEntityMetadataLike = {
  name: string;
  target?: unknown;
  columns: TypeOrmColumnMetadataLike[];
};

type TypeOrmRepositoryLike = {
  find(options?: Record<string, unknown>): Promise<Row[]>;
  findOne?: (options?: Record<string, unknown>) => Promise<Row | null>;
  findOneBy?: (where: Record<string, unknown>) => Promise<Row | null>;
  findOneOrFail?: (options?: Record<string, unknown>) => Promise<Row>;
  update(criteria: unknown, partialEntity: Record<string, unknown>): Promise<unknown>;
};

type TypeOrmDataSourceLike = {
  isInitialized?: boolean;
  initialize?: () => Promise<unknown>;
  destroy?: () => Promise<unknown>;
  entityMetadatas?: TypeOrmEntityMetadataLike[];
  getRepository: (target: unknown) => TypeOrmRepositoryLike;
};

type TraitScalar = number | string | boolean | null;
type PredictionSessionLike = Pick<PredictionSession, 'predict'>;
type CacheLike = Pick<TTLCache<string, TraitScalar>, 'get' | 'set'>;
type TypeOrmTraitCondition = Record<string, unknown>;
type TypeOrmWhere = Record<string, unknown> & {
  trait?: Record<string, TypeOrmTraitCondition>;
};
type TypeOrmFindOptionsLike = Record<string, unknown> & {
  where?: TypeOrmWhere;
};
type TypeOrmInterceptorOptions = {
  mode?: 'materialized' | 'live';
  predictionSession?: PredictionSessionLike;
  cache?: CacheLike;
  cacheTtlMs?: number;
  materializedColumnsPresent?: boolean;
};

type TypeOrmSharedState = {
  dataSource?: TypeOrmDataSourceLike;
  sourcePath?: string;
  projectRoot: string;
  initializedByAdapter: boolean;
};

function createSharedState(
  projectRoot: string,
  dataSource?: TypeOrmDataSourceLike,
): TypeOrmSharedState {
  return {
    dataSource,
    projectRoot,
    initializedByAdapter: false,
  };
}

function isDataSourceLike(value: unknown): value is TypeOrmDataSourceLike {
  return !!value && typeof value === 'object' && typeof (value as TypeOrmDataSourceLike).getRepository === 'function';
}

function isPredictionSessionLike(value: unknown): value is PredictionSessionLike {
  return !!value && typeof value === 'object' && typeof (value as PredictionSessionLike).predict === 'function';
}

function isCacheLike(value: unknown): value is CacheLike {
  return !!value && typeof value === 'object' && typeof (value as CacheLike).get === 'function' && typeof (value as CacheLike).set === 'function';
}

function normalizeTypeOrmInterceptorOptions(options: {
  mode?: 'materialized' | 'live';
  predictionSession?: unknown;
  cache?: unknown;
  cacheTtlMs?: number;
  materializedColumnsPresent?: boolean;
}): TypeOrmInterceptorOptions {
  return {
    mode: options.mode,
    predictionSession: isPredictionSessionLike(options.predictionSession) ? options.predictionSession : undefined,
    cache: isCacheLike(options.cache) ? options.cache : undefined,
    cacheTtlMs: options.cacheTtlMs,
    materializedColumnsPresent: options.materializedColumnsPresent,
  };
}

function createFeatureResolvers(featureNames: string[]): Record<string, (row: Row) => unknown> {
  return Object.fromEntries(featureNames.map((featureName) => [featureName, (row: Row) => row[featureName]]));
}

function resolveEntityName(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'function' && value.name) {
    return value.name;
  }
  if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
    return (value as { name: string }).name;
  }
  return null;
}

function matchesCondition(value: number, condition: TypeOrmTraitCondition): boolean {
  if ('gt' in condition && !(value > Number(condition.gt))) return false;
  if ('gte' in condition && !(value >= Number(condition.gte))) return false;
  if ('lt' in condition && !(value < Number(condition.lt))) return false;
  if ('lte' in condition && !(value <= Number(condition.lte))) return false;
  if ('equals' in condition && !(value === Number(condition.equals))) return false;
  return true;
}

async function applyTraitsToRow(
  row: Row,
  bindings: Array<{
    traitName: string;
    featureNames: string[];
    materializedColumn?: string;
    supportsLiveInference?: boolean;
  }>,
  options: Required<Pick<TypeOrmInterceptorOptions, 'mode'>> & {
    predictionSession?: PredictionSessionLike;
    cache: CacheLike;
    materializedColumnsPresent: boolean;
  }
): Promise<Row> {
  const augmented = { ...row };

  for (const binding of bindings) {
    const materializedColumn = binding.materializedColumn ?? binding.traitName;
    if (options.mode === 'materialized' && options.materializedColumnsPresent) {
      augmented[binding.traitName] = (row[materializedColumn] as TraitScalar | undefined) ?? null;
      continue;
    }

    if (options.mode === 'live') {
      if (!binding.supportsLiveInference || !options.predictionSession) {
        augmented[binding.traitName] = null;
        continue;
      }

      const cacheKey = `${binding.traitName}:${String(row.id)}`;
      const cached = options.cache.get(cacheKey);
      if (cached !== undefined) {
        augmented[binding.traitName] = cached;
        continue;
      }

      const prediction = await options.predictionSession.predict(
        binding.traitName,
        row,
        createFeatureResolvers(binding.featureNames)
      );
      options.cache.set(cacheKey, prediction.prediction);
      augmented[binding.traitName] = prediction.prediction;
      continue;
    }

    augmented[binding.traitName] = null;
  }

  return augmented;
}

function rewriteMaterializedWhere(
  where: TypeOrmWhere | undefined,
  bindings: Array<{ traitName: string; materializedColumn?: string }>,
  materializedColumnsPresent: boolean
): TypeOrmWhere | undefined {
  if (!where?.trait) {
    return where;
  }

  const cleanWhere: TypeOrmWhere = { ...where };
  const traitConditions = cleanWhere.trait;
  delete cleanWhere.trait;

  if (materializedColumnsPresent && traitConditions) {
    for (const [traitName, condition] of Object.entries(traitConditions)) {
      const binding = bindings.find((item) => item.traitName === traitName);
      if (binding) {
        cleanWhere[binding.materializedColumn ?? traitName] = condition;
      }
    }
  }

  return Object.keys(cleanWhere).length > 0 ? cleanWhere : undefined;
}

function passesLiveWhere(
  row: Row,
  where: TypeOrmWhere | undefined,
  bindings: Array<{ traitName: string }>
): boolean {
  if (!where?.trait) {
    return true;
  }

  for (const [traitName, condition] of Object.entries(where.trait)) {
    const binding = bindings.find((item) => item.traitName === traitName);
    if (!binding) {
      continue;
    }
    const value = row[traitName];
    if (typeof value !== 'number' || !matchesCondition(value, condition)) {
      return false;
    }
  }

  return true;
}

function resolveExportedDataSource(moduleExports: Record<string, unknown>): TypeOrmDataSourceLike {
  const candidates = [
    moduleExports.default,
    moduleExports.AppDataSource,
    moduleExports.appDataSource,
    moduleExports.dataSource,
    moduleExports.datasource,
  ];

  for (const candidate of candidates) {
    if (isDataSourceLike(candidate)) {
      return candidate;
    }
  }

  for (const candidate of Object.values(moduleExports)) {
    if (isDataSourceLike(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'TypeORM adapter could not find an exported DataSource. ' +
      'Export a DataSource instance (for example `AppDataSource`) from your schema module.'
  );
}

async function loadDataSourceFromModule(sourcePath: string, projectRoot: string): Promise<TypeOrmDataSourceLike> {
  const jiti = createJiti(pathToFileURL(__filename).href, { interopDefault: true });
  const resolvedSourcePath = path.resolve(projectRoot, sourcePath);
  const moduleExports = (await jiti.import(resolvedSourcePath)) as Record<string, unknown>;
  return resolveExportedDataSource(moduleExports);
}

async function ensureDataSource(state: TypeOrmSharedState, source?: string): Promise<TypeOrmDataSourceLike> {
  if (!state.dataSource) {
    const rawSourcePath = source ?? state.sourcePath;
    if (!rawSourcePath) {
      throw new Error('TypeORM adapter requires a schema source path that exports a DataSource.');
    }
    const sourcePath = path.resolve(rawSourcePath);
    state.sourcePath = sourcePath;
    state.dataSource = await loadDataSourceFromModule(sourcePath, state.projectRoot);
  }

  if (!state.dataSource.entityMetadatas || state.dataSource.entityMetadatas.length === 0) {
    if (state.dataSource.initialize && !state.dataSource.isInitialized) {
      await state.dataSource.initialize();
      state.initializedByAdapter = true;
    }
  } else if (state.dataSource.initialize && !state.dataSource.isInitialized) {
    await state.dataSource.initialize();
    state.initializedByAdapter = true;
  }

  return state.dataSource;
}

function mapTypeOrmType(typeName: string): FeatureDependency['scalarType'] {
  const lower = typeName.toLowerCase();
  if (
    lower === 'number' ||
    lower.includes('int') ||
    lower.includes('float') ||
    lower.includes('double') ||
    lower.includes('decimal') ||
    lower.includes('numeric') ||
    lower.includes('real')
  ) {
    return 'number';
  }
  if (lower.includes('bool')) {
    return 'boolean';
  }
  if (lower.includes('date') || lower.includes('time')) {
    return 'date';
  }
  if (
    lower.includes('char') ||
    lower.includes('text') ||
    lower.includes('uuid') ||
    lower.includes('enum') ||
    lower.includes('string')
  ) {
    return 'string';
  }
  return 'unknown';
}

function normalizeTypeOrmType(column: TypeOrmColumnMetadataLike): string {
  if (typeof column.type === 'string') {
    return column.type;
  }
  if (typeof column.type === 'function' && 'name' in column.type) {
    return String((column.type as { name?: unknown }).name ?? 'unknown');
  }
  return 'unknown';
}

function buildEntitySchema(metadata: TypeOrmEntityMetadataLike): EntitySchema {
  const fields: Record<string, FieldSchema> = {};

  for (const column of metadata.columns) {
    const normalizedType = normalizeTypeOrmType(column);
    fields[column.propertyName] = {
      name: column.propertyName,
      scalarType: mapTypeOrmType(normalizedType),
      nullable: Boolean(column.isNullable),
      isEnum: Array.isArray(column.enum) || (!!column.enum && typeof column.enum === 'object') || normalizedType.toLowerCase().includes('enum'),
    };
  }

  return { name: metadata.name, fields };
}

export class TypeOrmSchemaReader implements SchemaReader {
  private readonly state: TypeOrmSharedState;

  constructor(dataSource?: TypeOrmDataSourceLike, projectRoot: string = process.cwd(), state?: TypeOrmSharedState) {
    this.state = state ?? createSharedState(projectRoot, dataSource);
  }

  async readSchema(source: string): Promise<SchemaGraph> {
    this.state.sourcePath = source || this.state.sourcePath;
    const dataSource = await ensureDataSource(this.state, source);
    const entities = new Map<string, EntitySchema>();

    for (const metadata of dataSource.entityMetadatas ?? []) {
      entities.set(metadata.name, buildEntitySchema(metadata));
    }

    return { entities, rawSource: this.state.sourcePath ?? source ?? '' };
  }

  hashModel(graph: SchemaGraph, modelName: string): string {
    const entity = graph.entities.get(modelName);
    if (!entity) {
      return crypto
        .createHash('sha256')
        .update(JSON.stringify(Object.fromEntries(graph.entities)), 'utf-8')
        .digest('hex');
    }

    const sortedFields = Object.fromEntries(
      Object.entries(entity.fields).sort(([left], [right]) => left.localeCompare(right))
    );

    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ name: modelName, fields: sortedFields }), 'utf-8')
      .digest('hex');
  }
}

export class TypeOrmDataExtractor implements DataExtractor {
  private readonly state: TypeOrmSharedState;

  constructor(dataSource?: TypeOrmDataSourceLike, projectRoot: string = process.cwd(), state?: TypeOrmSharedState) {
    this.state = state ?? createSharedState(projectRoot, dataSource);
  }

  async extract(modelName: string, options: ExtractOptions = {}): Promise<Row[]> {
    const dataSource = await ensureDataSource(this.state);
    const entityMetadata = (dataSource.entityMetadatas ?? []).find((metadata) => metadata.name === modelName);
    const repository = dataSource.getRepository(entityMetadata?.target ?? modelName);

    const findOptions: Record<string, unknown> = {};
    if (options.where) {
      findOptions.where = options.where;
    }
    if (options.take !== undefined) {
      findOptions.take = options.take;
    }
    if (options.orderBy) {
      findOptions.order = { [options.orderBy]: 'ASC' };
    } else {
      findOptions.order = { id: 'ASC' };
    }

    return repository.find(findOptions);
  }

  async write(modelName: string, results: InferenceResult[], columnName: string = 'schemlPrediction'): Promise<void> {
    const dataSource = await ensureDataSource(this.state);
    const entityMetadata = (dataSource.entityMetadatas ?? []).find((metadata) => metadata.name === modelName);
    const repository = dataSource.getRepository(entityMetadata?.target ?? modelName);

    await Promise.all(
      results.map((result) =>
        repository.update({ id: result.entityId }, { [columnName]: result.prediction })
      )
    );
  }

  async disconnect(): Promise<void> {
    if (this.state.dataSource?.destroy && this.state.initializedByAdapter && this.state.dataSource.isInitialized) {
      await this.state.dataSource.destroy();
      this.state.initializedByAdapter = false;
    }
  }
}

export class TypeOrmQueryInterceptor implements QueryInterceptor {
  constructor(
    private readonly state: TypeOrmSharedState,
    private readonly traits: Array<{
      traitName: string;
      entityName: string;
      featureNames: string[];
      materializedColumn?: string;
      supportsLiveInference?: boolean;
    }>,
    private readonly options: TypeOrmInterceptorOptions = {}
  ) {}

  extendClient(client: unknown): unknown {
    if (!isDataSourceLike(client)) {
      throw new Error('TypeOrmQueryInterceptor requires a TypeORM DataSource-like client with getRepository()');
    }

    this.state.dataSource = client;

    const mode = this.options.mode ?? 'materialized';
    const predictionSession = this.options.predictionSession;
    const cache = this.options.cache ?? new TTLCache<string, TraitScalar>(this.options.cacheTtlMs ?? 30_000);
    const materializedColumnsPresent = this.options.materializedColumnsPresent ?? (mode !== 'live');

    return new Proxy(client, {
      get: (target, prop, receiver) => {
        if (prop !== 'getRepository') {
          return Reflect.get(target as object, prop, receiver);
        }

        return (entityTarget: unknown) => {
          const repository = target.getRepository(entityTarget);
          const entityName = resolveEntityName(entityTarget);
          if (!entityName) {
            return repository;
          }

          const bindings = this.traits.filter((trait) => trait.entityName.toLowerCase() === entityName.toLowerCase());
          if (bindings.length === 0) {
            return repository;
          }

          return new Proxy(repository, {
            get: (repoTarget, repoProp, repoReceiver) => {
              if (repoProp === 'find') {
                return async (options?: TypeOrmFindOptionsLike) => {
                  const rewrittenOptions: TypeOrmFindOptionsLike = {
                    ...(options ?? {}),
                    where: mode === 'materialized'
                      ? rewriteMaterializedWhere(options?.where, bindings, materializedColumnsPresent)
                      : rewriteMaterializedWhere(options?.where, [], false),
                  };
                  const rows = await repoTarget.find(rewrittenOptions.where ? rewrittenOptions : { ...(options ?? {}), where: undefined });
                  const augmented = await Promise.all(
                    rows.map((row) => applyTraitsToRow(row, bindings, { mode, predictionSession, cache, materializedColumnsPresent }))
                  );
                  return mode === 'live'
                    ? augmented.filter((row) => passesLiveWhere(row, options?.where, bindings))
                    : augmented;
                };
              }

              if (repoProp === 'findOne' && typeof repoTarget.findOne === 'function') {
                const findOne = repoTarget.findOne.bind(repoTarget);
                return async (options?: TypeOrmFindOptionsLike) => {
                  const rewrittenOptions: TypeOrmFindOptionsLike = {
                    ...(options ?? {}),
                    where: mode === 'materialized'
                      ? rewriteMaterializedWhere(options?.where, bindings, materializedColumnsPresent)
                      : rewriteMaterializedWhere(options?.where, [], false),
                  };
                  const row = await findOne(rewrittenOptions.where ? rewrittenOptions : { ...(options ?? {}), where: undefined });
                  if (!row) return null;
                  const augmented = await applyTraitsToRow(row, bindings, { mode, predictionSession, cache, materializedColumnsPresent });
                  return mode === 'live' && !passesLiveWhere(augmented, options?.where, bindings) ? null : augmented;
                };
              }

              if (repoProp === 'findOneBy' && typeof repoTarget.findOneBy === 'function') {
                const findOneBy = repoTarget.findOneBy.bind(repoTarget);
                return async (where: TypeOrmWhere) => {
                  const row = await findOneBy(mode === 'materialized'
                    ? (rewriteMaterializedWhere(where, bindings, materializedColumnsPresent) ?? {})
                    : (rewriteMaterializedWhere(where, [], false) ?? {}));
                  if (!row) return null;
                  const augmented = await applyTraitsToRow(row, bindings, { mode, predictionSession, cache, materializedColumnsPresent });
                  return mode === 'live' && !passesLiveWhere(augmented, where, bindings) ? null : augmented;
                };
              }

              if (repoProp === 'findOneOrFail' && typeof repoTarget.findOneOrFail === 'function') {
                const findOneOrFail = repoTarget.findOneOrFail.bind(repoTarget);
                return async (options?: TypeOrmFindOptionsLike) => {
                  const rewrittenOptions: TypeOrmFindOptionsLike = {
                    ...(options ?? {}),
                    where: mode === 'materialized'
                      ? rewriteMaterializedWhere(options?.where, bindings, materializedColumnsPresent)
                      : rewriteMaterializedWhere(options?.where, [], false),
                  };
                  const row = await findOneOrFail(rewrittenOptions.where ? rewrittenOptions : { ...(options ?? {}), where: undefined });
                  const augmented = await applyTraitsToRow(row, bindings, { mode, predictionSession, cache, materializedColumnsPresent });
                  if (mode === 'live' && !passesLiveWhere(augmented, options?.where, bindings)) {
                    throw new Error(`No ${entityName} row satisfied the requested live trait filters.`);
                  }
                  return augmented;
                };
              }

              return Reflect.get(repoTarget as object, repoProp, repoReceiver);
            },
          });
        };
      },
    });
  }
}

export function createTypeOrmAdapter(options: {
  dataSource?: TypeOrmDataSourceLike;
  projectRoot?: string;
} = {}): ScheMLAdapter {
  const state = createSharedState(options.projectRoot ?? process.cwd(), options.dataSource);
  return {
    name: 'typeorm',
    reader: new TypeOrmSchemaReader(options.dataSource, options.projectRoot, state),
    extractor: new TypeOrmDataExtractor(options.dataSource, options.projectRoot, state),
    createInterceptor: (traits, options) =>
      new TypeOrmQueryInterceptor(state, traits, normalizeTypeOrmInterceptorOptions(options)),
  };
}