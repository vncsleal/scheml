/**
 * ScheML Adapter Interface
 *
 * Adapters make ScheML schema-agnostic. Each adapter translates a specific
 * schema source (Prisma, Drizzle, Zod) into a common representation so that
 * the training pipeline and CLI commands work without touching source-specific
 * code.
 */

import type { FeatureDependency } from '../types';

// ---------------------------------------------------------------------------
// SchemaGraph — the common representation produced by SchemaReader
// ---------------------------------------------------------------------------

/**
 * A field extracted from any schema source.
 */
export interface FieldSchema {
  /** Field name as it appears in the schema */
  name: string;
  /** Normalised scalar type — matches FeatureDependency.scalarType */
  scalarType: FeatureDependency['scalarType'];
  /** Whether the field allows null / undefined */
  nullable: boolean;
  /** True when the field references an enum rather than a primitive type */
  isEnum: boolean;
}

/**
 * Entity (model / table / schema) metadata extracted from a schema source.
 */
export interface EntitySchema {
  /** Entity name (e.g. "User", "users") */
  name: string;
  /** Field definitions keyed by field name */
  fields: Record<string, FieldSchema>;
}

/**
 * The normalised, adapter-agnostic schema graph returned by `SchemaReader.readSchema`.
 * It is the canonical hash substrate for artifact metadata — the same object
 * is passed to `SchemaReader.hashModel` later.
 */
export interface SchemaGraph {
  /** All entities known to this schema, keyed by entity name */
  entities: Map<string, EntitySchema>;
  /**
   * Raw source string used to build this graph.
   * Kept for adapters that need it for secondary operations (e.g. subset hashing).
   */
  rawSource: string;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Options forwarded to a DataExtractor when pulling rows. */
export interface ExtractOptions {
  /** Field to deterministically order rows by (default: 'id') */
  orderBy?: string;
  /** Simple equality filter applied server-side */
  where?: Record<string, unknown>;
  /** Maximum rows to retrieve (default: unlimited) */
  take?: number;
}

/** A single entity row as returned by a DataExtractor */
export type Row = Record<string, unknown>;

/** A model prediction result — used by DataExtractor.write for materialise */
export interface InferenceResult {
  entityId: unknown;
  prediction: number | string | boolean;
}

// ---------------------------------------------------------------------------
// Core adapter interfaces
// ---------------------------------------------------------------------------

/**
 * Reads a schema source and converts it to the adapter-agnostic SchemaGraph.
 * Also responsible for deterministic per-model hashing.
 */
export interface SchemaReader {
  /**
   * Parse the schema at `source` (a file path, connection string, or inline
   * schema string depending on the adapter) and return the SchemaGraph.
   */
  readSchema(source: string): Promise<SchemaGraph>;

  /**
   * Return a deterministic hash for a single named entity in the graph.
   * Only the entity and its direct references (enum types) are hashed, so
   * changes to unrelated entities do not invalidate artefacts.
   */
  hashModel(graph: SchemaGraph, modelName: string): string;
}

/**
 * Extracts rows from the underlying data store for training, and optionally
 * writes prediction results back (used by `scheml materialize`).
 */
export interface DataExtractor {
  /**
   * Fetch rows for the given entity.
   * The caller is responsible for filtering to relevant columns via feature resolvers.
   */
  extract(modelName: string, options?: ExtractOptions): Promise<Row[]>;

  /**
   * Persist inference results back to the data store.
   * Only required for adapters that support materialisation.
   */
  write?(modelName: string, results: InferenceResult[], columnName?: string): Promise<void>;

  /**
   * Gracefully close the underlying data source connection.
   * Called in `finally` blocks after training / materialisation.
   */
  disconnect?(): Promise<void>;
}

/**
 * Extends the underlying client with computed trait properties so that
 * query results carry predictions as native fields.
 * Optional — not all adapters support a middleware / extension concept.
 */
export interface QueryInterceptor {
  extendClient(client: unknown): unknown;
}

/**
 * The top-level adapter object registered in the adapter registry.
 * At minimum an adapter must provide a `SchemaReader`.
 */
export interface ScheMLAdapter {
  /** Unique adapter name, used in config and error messages */
  name: string;
  /**
   * Optional dialect hint (e.g. 'postgresql', 'mysql', 'sqlite').
   * Adapters that derive it from the schema source (e.g. Prisma datasource block)
   * may leave this undefined until after the first `reader.readSchema` call.
   */
  dialect?: string;
  reader: SchemaReader;
  extractor?: DataExtractor;
  interceptor?: QueryInterceptor;
  /**
   * Factory for a fully-configured `QueryInterceptor` for runtime client
   * extension.  Adapters that support `extendClient` must implement this so
   * that callers can provide trait configuration without importing the
   * adapter-specific interceptor class directly.
   */
  createInterceptor?: (
    traits: Array<{
      traitName: string;
      entityName: string;
      featureNames: string[];
      materializedColumn?: string;
      supportsLiveInference?: boolean;
    }>,
    options: {
      mode?: 'materialized' | 'live';
      predictionSession?: unknown;
      cache?: unknown;
      cacheTtlMs?: number;
      materializedColumnsPresent?: boolean;
    }
  ) => QueryInterceptor;
}
