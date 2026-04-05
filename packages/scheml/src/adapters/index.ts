/**
 * Adapter Registry
 *
 * Centralised lookup for named adapters so that `scheml.config.ts` can specify
 * `adapter: 'prisma'` (a string) and the training pipeline resolves the right
 * implementation without importing all adapters unconditionally.
 *
 * Custom adapters can be registered at runtime before the pipeline runs.
 */

import type { ScheMLAdapter } from './interface';
import { createPrismaAdapter } from './prisma';
import { createZodAdapter } from './zod';
import { createDrizzleAdapter } from './drizzle';

// Re-export all interfaces and adapter factories for convenience
export type {
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

export { PrismaSchemaReader, PrismaDataExtractor, PrismaQueryInterceptor, createPrismaAdapter } from './prisma';
export { ZodSchemaReader, createZodAdapter } from './zod';
export { DrizzleSchemaReader, DrizzleDataExtractor, createDrizzleAdapter } from './drizzle';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _registry = new Map<string, () => ScheMLAdapter>();

/**
 * Register a named adapter factory.
 * The factory is called lazily on the first `getAdapter(name)` call.
 *
 * Built-in adapters ('prisma', 'zod', 'drizzle') are registered automatically
 * the first time this module is imported.
 */
export function registerAdapter(name: string, factory: () => ScheMLAdapter): void {
  _registry.set(name, factory);
}

/**
 * Retrieve a named adapter.
 * Built-in adapters are auto-registered; custom adapters must be registered
 * via `registerAdapter` before calling this function.
 *
 * @throws Error if no adapter with the given name is registered.
 */
export function getAdapter(name: string): ScheMLAdapter {
  // Lazy-load built-in adapters to avoid pulling in dependencies that the
  // consumer may not have installed (e.g. drizzle-orm is optional).
  if (_registry.has(name)) {
    return _registry.get(name)!();
  }

  let factory: () => ScheMLAdapter;
  switch (name) {
    case 'prisma':  factory = () => createPrismaAdapter(); break;
    case 'zod':     factory = () => createZodAdapter(); break;
    case 'drizzle': factory = () => createDrizzleAdapter(); break;
    default:
      throw new Error(
        `ScheML: unknown adapter "${name}". ` +
        `Built-in adapters: prisma, zod, drizzle. ` +
        `Register custom adapters with registerAdapter().`
      );
  }

  // Cache built-in factory so listAdapters() reflects loaded built-ins.
  _registry.set(name, factory);
  return factory();
}

/**
 * Returns the list of currently registered adapter names.
 */
export function listAdapters(): string[] {
  return Array.from(_registry.keys());
}
