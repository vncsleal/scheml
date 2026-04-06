import { createJiti } from 'jiti';
import { pathToFileURL } from 'url';
import type { AnyTraitDefinition } from '../traitTypes';
import type { ScheMLConfig } from '../defineConfig';

export type CommandConfigExports = Record<string, unknown> & Partial<ScheMLConfig> & {
  default?: Partial<ScheMLConfig>;
};

const TRAIT_TYPES = new Set<AnyTraitDefinition['type']>([
  'predictive',
  'anomaly',
  'similarity',
  'temporal',
  'generative',
]);

export function isTraitDefinition(value: unknown): value is AnyTraitDefinition {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { name?: unknown; type?: unknown };
  return typeof candidate.name === 'string' && typeof candidate.type === 'string' && TRAIT_TYPES.has(candidate.type as AnyTraitDefinition['type']);
}

export async function loadConfigModule(configPath: string): Promise<CommandConfigExports> {
  const jiti = createJiti(pathToFileURL(__filename).href, { interopDefault: true });
  return (await jiti.import(configPath)) as CommandConfigExports;
}

export function normalizeConfigExports(configModule: CommandConfigExports): CommandConfigExports {
  return configModule.default && typeof configModule.default === 'object'
    ? { ...configModule, ...configModule.default }
    : configModule;
}

export function extractTraitDefinitions(configExports: CommandConfigExports): AnyTraitDefinition[] {
  const configuredTraits = configExports.traits;
  if (!Array.isArray(configuredTraits)) {
    return [];
  }

  const traits: AnyTraitDefinition[] = [];
  const seen = new Set<string>();

  for (const value of configuredTraits) {
    if (!isTraitDefinition(value) || seen.has(value.name)) {
      continue;
    }

    seen.add(value.name);
    traits.push(value);
  }

  return traits;
}