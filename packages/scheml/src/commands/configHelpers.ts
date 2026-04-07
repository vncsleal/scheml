import { createJiti } from 'jiti';
import { pathToFileURL } from 'url';
import type { AnyTraitDefinition } from '../traitTypes';
import type { ScheMLConfig } from '../defineConfig';
import { resolveTraitGraph, topologicalSort } from '../traitGraph';
import { assertValidTraitName } from '../traitNames';

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
    if (!isTraitDefinition(value)) {
      continue;
    }

    assertValidTraitName(value.name);

    if (seen.has(value.name)) {
      throw new Error(`Duplicate trait name: "${value.name}". Each trait must have a unique name.`);
    }

    seen.add(value.name);
    traits.push(value);
  }

  return traits;
}

export function resolveTraitDefinitions(configExports: CommandConfigExports): AnyTraitDefinition[] {
  const traits = extractTraitDefinitions(configExports);
  resolveTraitGraph(traits);
  return topologicalSort(traits);
}

export function selectTraitDefinitions(
  traits: AnyTraitDefinition[],
  traitName?: string,
  options: { includeDependencies?: boolean } = {}
): AnyTraitDefinition[] {
  if (!traitName) {
    return traits;
  }

  const target = traits.find((trait) => trait.name === traitName);
  if (!target) {
    throw new Error(`Trait "${traitName}" not found in config`);
  }

  if (!options.includeDependencies) {
    return [target];
  }

  const includedNames = new Set<string>();

  const visit = (trait: AnyTraitDefinition): void => {
    if (includedNames.has(trait.name)) {
      return;
    }

    for (const dependency of trait.traits ?? []) {
      visit(dependency);
    }

    includedNames.add(trait.name);
  };

  visit(target);
  return traits.filter((trait) => includedNames.has(trait.name));
}