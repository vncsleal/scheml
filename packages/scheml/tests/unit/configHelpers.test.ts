import { describe, expect, it } from 'vitest';
import { extractTraitDefinitions, normalizeConfigExports } from '../../src/commands/configHelpers';

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

  it('deduplicates traits by name within config.traits', () => {
    const trait = { name: 'dup', type: 'anomaly', baseline: ['cpu'] };
    const configExports = {
      adapter: 'prisma',
      traits: [trait, trait, { ...trait }],
    };

    expect(extractTraitDefinitions(configExports)).toEqual([trait]);
  });

  it('returns an empty list when config.traits is absent', () => {
    expect(extractTraitDefinitions({ adapter: 'prisma', strayTrait: { name: 'x', type: 'predictive' } })).toEqual([]);
  });
});