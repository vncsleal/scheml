import { describe, expect, it } from 'vitest';
import { defineTrait } from '../../src/defineTrait';
import {
  extractTraitDefinitions,
  normalizeConfigExports,
  resolveTraitDefinitions,
  selectTraitDefinitions,
} from '../../src/commands/configHelpers';

describe('command config trait discovery', () => {
  it('reads traits from config.traits as the canonical source', () => {
    const namedExportTrait = { name: 'namedOnly', type: 'predictive', target: 'x', features: ['age'] };
    const configuredTrait = { name: 'configured', type: 'predictive', target: 'y', features: ['spend'] };

    const configExports = normalizeConfigExports({
      default: {
        adapter: 'prisma',
        traits: [configuredTrait],
      },
      namedExportTrait,
    });

    expect(extractTraitDefinitions(configExports)).toEqual([configuredTrait]);
  });

  it('throws on duplicate trait names within config.traits', () => {
    const trait = { name: 'dup', type: 'anomaly', baseline: ['cpu'] };
    const configExports = {
      adapter: 'prisma',
      traits: [trait, trait, { ...trait }],
    };

    expect(() => extractTraitDefinitions(configExports)).toThrow('Duplicate trait name');
  });

  it('returns an empty list when config.traits is absent', () => {
    expect(extractTraitDefinitions({ adapter: 'prisma', strayTrait: { name: 'x', type: 'predictive' } })).toEqual([]);
  });

  it('validates trait graphs and returns traits in dependency order', () => {
    const base = defineTrait('User', {
      type: 'anomaly',
      name: 'baseScore',
      baseline: ['spend'],
      sensitivity: 'low',
    });
    const derived = defineTrait('User', {
      type: 'anomaly',
      name: 'derivedScore',
      baseline: ['spend'],
      sensitivity: 'medium',
      traits: [base],
    });

    const traits = resolveTraitDefinitions({
      adapter: 'prisma',
      traits: [derived, base],
    });

    expect(traits.map((trait) => trait.name)).toEqual(['baseScore', 'derivedScore']);
  });

  it('selects a target trait together with its dependencies in topological order', () => {
    const base = defineTrait('User', {
      type: 'anomaly',
      name: 'baseScore',
      baseline: ['spend'],
      sensitivity: 'low',
    });
    const mid = defineTrait('User', {
      type: 'anomaly',
      name: 'midScore',
      baseline: ['spend'],
      sensitivity: 'medium',
      traits: [base],
    });
    const top = defineTrait('User', {
      type: 'anomaly',
      name: 'topScore',
      baseline: ['spend'],
      sensitivity: 'high',
      traits: [mid],
    });

    const traits = resolveTraitDefinitions({
      adapter: 'prisma',
      traits: [top, base, mid],
    });
    const selected = selectTraitDefinitions(traits, 'topScore', { includeDependencies: true });

    expect(selected.map((trait) => trait.name)).toEqual(['baseScore', 'midScore', 'topScore']);
  });
});