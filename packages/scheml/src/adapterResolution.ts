import { createRequire } from 'module';
import { getAdapter } from './adapters';
import type { ScheMLAdapter } from './adapters/interface';
import type { BaseTraitDefinition } from './traitTypes';

type AdapterCandidate = {
  name?: unknown;
  reader?: {
    readSchema?: unknown;
    hashModel?: unknown;
  };
};

const moduleRequire = createRequire(__filename);

type TraitWithRuntimeEntity = BaseTraitDefinition & {
  entity: unknown;
};

export function isScheMLAdapter(value: unknown): value is ScheMLAdapter {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as AdapterCandidate;
  return (
    typeof candidate.name === 'string' &&
    !!candidate.reader &&
    typeof candidate.reader.readSchema === 'function' &&
    typeof candidate.reader.hashModel === 'function'
  );
}

export function resolveConfiguredAdapter(configAdapter: unknown): ScheMLAdapter {
  if (isScheMLAdapter(configAdapter)) {
    return configAdapter;
  }

  if (typeof configAdapter === 'string' && configAdapter.length > 0) {
    return getAdapter(configAdapter);
  }

  throw new Error(
    'adapter is required in scheml.config.ts. ' +
    "Set adapter to a built-in adapter name ('prisma', 'drizzle', 'typeorm', 'zod') or a configured adapter instance."
  );
}

export function resolveSchemaPath(configSchema: unknown, cliSchema?: unknown): string | undefined {
  if (typeof cliSchema === 'string' && cliSchema.length > 0) {
    return cliSchema;
  }

  if (typeof configSchema === 'string' && configSchema.length > 0) {
    return configSchema;
  }

  return undefined;
}

export function tryGetDrizzleTableName(entity: unknown): string | null {
  try {
    const drizzleOrm = moduleRequire('drizzle-orm') as { getTableName?: (table: unknown) => unknown };
    if (typeof drizzleOrm.getTableName === 'function') {
      const name = drizzleOrm.getTableName(entity);
      return typeof name === 'string' && name.length > 0 ? name : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveTraitEntityName(trait: TraitWithRuntimeEntity, adapterName: string): string | null {
  if (typeof trait.entity === 'string') {
    return trait.entity;
  }

  if (adapterName === 'drizzle') {
    const tableName = tryGetDrizzleTableName(trait.entity);
    if (tableName) {
      return tableName;
    }
  }

  if (typeof trait.entity === 'function' && trait.entity.name) {
    return trait.entity.name;
  }

  if (trait.entity && typeof trait.entity === 'object' && typeof (trait.entity as { name?: unknown }).name === 'string') {
    return (trait.entity as { name: string }).name;
  }

  return null;
}

export function requireTraitEntityName(trait: TraitWithRuntimeEntity, adapterName: string): string {
  const entityName = resolveTraitEntityName(trait, adapterName);
  if (!entityName) {
    throw new Error(
      `Trait "${trait.name}" uses an entity reference that ScheML could not resolve for adapter "${adapterName}". ` +
      'Pass a string entity name, a Drizzle table object, or a named class/object that the adapter can identify.'
    );
  }
  return entityName;
}