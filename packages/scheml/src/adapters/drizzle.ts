/**
 * Drizzle Adapter
 *
 * Implements SchemaReader and DataExtractor for Drizzle ORM.
 *
 * Drizzle schemas are plain TypeScript objects built with the `drizzle-orm`
 * table helpers (e.g. `pgTable`, `mysqlTable`, `sqliteTable`). The adapter
 * inspects the column metadata stored on each table object at runtime so no
 * build step or code-generation is required.
 *
 * Usage:
 * ```ts
 * import { pgTable, serial, varchar, boolean } from 'drizzle-orm/pg-core';
 * import { DrizzleSchemaReader } from '@vncsleal/scheml/adapters/drizzle';
 *
 * const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   email: varchar('email', { length: 255 }).notNull(),
 *   active: boolean('active').notNull(),
 * });
 *
 * const reader = new DrizzleSchemaReader({ User: users });
 * const graph = await reader.readSchema('User');
 * ```
 *
 * NOTE: QueryInterceptor is intentionally absent for Drizzle — Drizzle has no
 * client-level middleware / extension concept equivalent to Prisma's $extends.
 */

import * as crypto from 'crypto';
import { createRequire } from 'module';
import type {
  SchemaGraph,
  EntitySchema,
  FieldSchema,
  SchemaReader,
  DataExtractor,
  ScheMLAdapter,
  ExtractOptions,
  Row,
  InferenceResult,
} from './interface';
import type { FeatureDependency } from '../types';

// ---------------------------------------------------------------------------
// Drizzle column introspection — minimal, avoids a hard drizzle-orm dep.
// Drizzle stores column metadata on `[table][Symbol.for('drizzle:Columns')]`
// (or the older `table[Columns]` export from 'drizzle-orm') but the column
// objects always expose a `columnType` string via `getSQLType()` or
// `config.dataType` / `config.columnType`.
// ---------------------------------------------------------------------------

type DrizzleColumn = {
  name?: string;
  columnType?: string;
  dataType?: string;
  notNull?: boolean;
  // drizzle-orm ≥ 0.29 exposes config
  config?: { notNull?: boolean; dataType?: string; columnType?: string };
};

type DrizzleTable = {
  [key: string]: unknown;
};

type DrizzlePredicate = unknown;
type DrizzleQueryLike = {
  from(table: DrizzleTable): DrizzleQueryLike;
  where(condition: DrizzlePredicate): DrizzleQueryLike;
  limit(count: number): DrizzleQueryLike;
} & PromiseLike<Row[]>;

type DrizzleDbLike = {
  select(): DrizzleQueryLike;
  update(table: DrizzleTable): {
    set(values: Record<string, unknown>): {
      where(condition: DrizzlePredicate): Promise<unknown>;
    };
  };
};

type DrizzleOrmModule = {
  eq(left: unknown, right: unknown): DrizzlePredicate;
  and(...conditions: DrizzlePredicate[]): DrizzlePredicate;
  Table?: {
    Symbol?: {
      Columns?: symbol;
    };
  };
};

const DRIZZLE_COLUMNS_SYMBOL = Symbol.for('drizzle:Columns');
const moduleRequire = createRequire(__filename);

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return !!value && typeof value === 'object';
}

function getTableColumn(table: DrizzleTable, key: string): unknown {
  return table[key];
}

function hasDrizzleOrmModule(value: unknown): value is DrizzleOrmModule {
  return isObjectRecord(value) && typeof value.eq === 'function' && typeof value.and === 'function';
}

function loadDrizzleOrmModule(): DrizzleOrmModule | null {
  try {
    const drizzleOrm = moduleRequire('drizzle-orm') as unknown;
    return hasDrizzleOrmModule(drizzleOrm) ? drizzleOrm : null;
  } catch {
    return null;
  }
}

/** Extract named columns from a Drizzle table object */
function getDrizzleColumnsSymbol(): symbol {
  const drizzleOrm = loadDrizzleOrmModule();
  const moduleSymbol = drizzleOrm?.Table?.Symbol?.Columns;
  return typeof moduleSymbol === 'symbol' ? moduleSymbol : DRIZZLE_COLUMNS_SYMBOL;
}

function extractDrizzleColumns(table: DrizzleTable): Record<string, DrizzleColumn> {
  const columnsSymbol = getDrizzleColumnsSymbol();
  const symbolCols = isObjectRecord(table) ? table[columnsSymbol] : undefined;
  if (symbolCols && typeof symbolCols === 'object') {
    return symbolCols as Record<string, DrizzleColumn>;
  }

  throw new Error(
    'Drizzle table introspection failed: expected a Drizzle table object with an internal Columns symbol. '
    + 'Pass real table objects returned by drizzle-orm schema helpers.'
  );
}

/** Map a Drizzle column type string to the common scalarType */
function mapDrizzleType(col: DrizzleColumn): FeatureDependency['scalarType'] {
  const raw =
    col.columnType ??
    col.dataType ??
    col.config?.columnType ??
    col.config?.dataType ??
    '';

  const lower = raw.toLowerCase();

  if (lower.includes('int') || lower.includes('serial') || lower.includes('numeric') ||
      lower.includes('float') || lower.includes('double') || lower.includes('decimal') ||
      lower.includes('real')) {
    return 'number';
  }
  if (lower.includes('bool')) return 'boolean';
  if (lower.includes('date') || lower.includes('time') || lower.includes('timestamp')) {
    return 'date';
  }
  if (lower.includes('char') || lower.includes('text') || lower.includes('uuid') ||
      lower.includes('string') || lower.includes('enum')) {
    return 'string';
  }
  return 'unknown';
}

function isNullable(col: DrizzleColumn): boolean {
  // notNull=true means NOT nullable
  const notNull = col.notNull ?? col.config?.notNull ?? false;
  return !notNull;
}

// ---------------------------------------------------------------------------
// DrizzleSchemaReader
// ---------------------------------------------------------------------------

/**
 * Reads Drizzle table definitions and converts them to the common SchemaGraph.
 * The `source` param to `readSchema` is ignored (schemas are provided to constructor).
 */
export class DrizzleSchemaReader implements SchemaReader {
  constructor(private readonly tables: Record<string, DrizzleTable> = {}) {}

  async readSchema(_source: string): Promise<SchemaGraph> {
    const entities = new Map<string, EntitySchema>();

    for (const [entityName, table] of Object.entries(this.tables)) {
      const columns = extractDrizzleColumns(table);
      const fields: Record<string, FieldSchema> = {};

      for (const [colKey, col] of Object.entries(columns)) {
        const raw = col.columnType ?? col.dataType ?? col.config?.columnType ?? '';
        fields[colKey] = {
          name:       colKey,
          scalarType: mapDrizzleType(col),
          nullable:   isNullable(col),
          isEnum:     raw.toLowerCase().includes('enum'),
        };
      }

      entities.set(entityName, { name: entityName, fields });
    }

    return { entities, rawSource: '' };
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
      Object.entries(entity.fields).sort(([a], [b]) => a.localeCompare(b))
    );
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ name: modelName, fields: sortedFields }), 'utf-8')
      .digest('hex');
  }
}

// ---------------------------------------------------------------------------
// DrizzleDataExtractor
// ---------------------------------------------------------------------------

/**
 * Extracts rows via a Drizzle `db` instance.
 * The `db` value is any object with a `select()` method (Drizzle query API).
 */
export class DrizzleDataExtractor implements DataExtractor {
  constructor(
    private readonly db: DrizzleDbLike,
    private readonly tables: Record<string, DrizzleTable> = {}
  ) {}

  async extract(modelName: string, options: ExtractOptions = {}): Promise<Row[]> {
    const table = this.tables[modelName];
    if (!table) {
      throw new Error(
        `DrizzleDataExtractor: no table registered for entity "${modelName}". ` +
        `Pass it in the tables map when creating the extractor.`
      );
    }

    // Build a basic select query. Drizzle's fluent API is chain-based.
    let query = this.db.select().from(table);

    if (options.where) {
      // Simple equality filtering — the caller passes { field: value } pairs.
      // drizzle-orm is an optional peer dependency; skip filtering if not installed.
      const drizzleOrm = loadDrizzleOrmModule();
      if (drizzleOrm) {
        const { eq, and } = drizzleOrm;
        const conditions = Object.entries(options.where).map(([field, value]) =>
          eq(getTableColumn(table, field), value)
        );
        query = conditions.length === 1
          ? query.where(conditions[0])
          : query.where(and(...conditions));
      }
    }

    if (options.take !== undefined) {
      query = query.limit(options.take);
    }

    return await query;
  }

  async write(modelName: string, results: InferenceResult[], columnName = 'schemlPrediction'): Promise<void> {
    const table = this.tables[modelName];
    if (!table) {
      throw new Error(`DrizzleDataExtractor: no table registered for entity "${modelName}"`);
    }
    const drizzleOrm = loadDrizzleOrmModule();
    if (!drizzleOrm) {
      throw new Error('drizzle-orm must be installed to use DrizzleDataExtractor.write');
    }
    const { eq } = drizzleOrm;

    await Promise.all(
      results.map((r) =>
        this.db
          .update(table)
          .set({ [columnName]: r.prediction })
          .where(eq(getTableColumn(table, 'id'), r.entityId))
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Drizzle adapter factory
// ---------------------------------------------------------------------------

/**
 * Creates a Drizzle adapter.
 *
 * @param tables  - Map of entity name → Drizzle table object (required for schema reading)
 * @param db      - Optional Drizzle `db` instance; when provided, data extraction is enabled
 */
export function createDrizzleAdapter(
  tables: Record<string, DrizzleTable> = {},
  db?: DrizzleDbLike
): ScheMLAdapter {
  const reader = new DrizzleSchemaReader(tables);
  const extractor = db ? new DrizzleDataExtractor(db, tables) : undefined;

  return {
    name: 'drizzle',
    reader,
    extractor,
  };
}
