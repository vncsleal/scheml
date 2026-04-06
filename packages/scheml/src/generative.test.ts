import { describe, it, expect, vi } from 'vitest';
import {
  detectOutputSchemaShape,
  validateGenerativeTrait,
  compileGenerativeTrait,
  type OutputSchemaShape,
} from './generative';
import type { GenerativeTrait } from './traitTypes';
import type { GenerativeArtifactMetadata } from './artifacts';

// ---------------------------------------------------------------------------
// Helpers — minimal Zod-like schema stubs
// ---------------------------------------------------------------------------

const stubZodMethods = {
  parse: (data: unknown) => data,
  safeParse: (data: unknown) => ({ success: true, data }),
};

function zodString() {
  return { ...stubZodMethods, _def: { typeName: 'ZodString' } };
}

function zodEnum(values: string[]) {
  return { ...stubZodMethods, _def: { typeName: 'ZodEnum', values } };
}

function zodObject() {
  return {
    ...stubZodMethods,
    _def: {
      typeName: 'ZodObject',
      shape: () => ({}),
    },
  };
}

function makeGenerativeTrait(
  overrides: Partial<GenerativeTrait> = {}
): GenerativeTrait {
  return {
    type: 'generative',
    name: 'retentionMessage',
    entity: 'User',
    context: ['plan', 'churned'],
    prompt: 'Write a retention message for this user.',
    ...overrides,
  } as GenerativeTrait;
}

// ---------------------------------------------------------------------------
// detectOutputSchemaShape
// ---------------------------------------------------------------------------

describe('detectOutputSchemaShape', () => {
  it('returns text for undefined schema', () => {
    expect(detectOutputSchemaShape(undefined)).toEqual({ shape: 'text' });
  });

  it('returns text for null schema', () => {
    expect(detectOutputSchemaShape(null)).toEqual({ shape: 'text' });
  });

  it('returns text for ZodString', () => {
    expect(detectOutputSchemaShape(zodString()).shape).toBe('text');
  });

  it('returns text for unknown typeName', () => {
    const unknown = { _def: { typeName: 'ZodUnknown' } };
    expect(detectOutputSchemaShape(unknown).shape).toBe('text');
  });

  it('returns text for non-object', () => {
    expect(detectOutputSchemaShape(42).shape).toBe('text');
    expect(detectOutputSchemaShape('hello').shape).toBe('text');
  });

  it('returns choice for ZodEnum with options array', () => {
    const result = detectOutputSchemaShape(zodEnum(['approve', 'deny', 'review']));
    expect(result.shape).toBe('choice');
    expect(result.choiceOptions).toEqual(['approve', 'deny', 'review']);
  });

  it('returns choice for ZodEnum with object values', () => {
    const schema = {
      _def: {
        typeName: 'ZodEnum',
        values: { Approve: 'approve', Deny: 'deny' },
      },
    };
    const result = detectOutputSchemaShape(schema);
    expect(result.shape).toBe('choice');
    expect(result.choiceOptions).toEqual(['approve', 'deny']);
  });

  it('returns object for ZodObject', () => {
    expect(detectOutputSchemaShape(zodObject()).shape).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// validateGenerativeTrait
// ---------------------------------------------------------------------------

describe('validateGenerativeTrait', () => {
  it('passes when all context fields exist in schema', () => {
    const trait = makeGenerativeTrait();
    const fields = new Set(['id', 'plan', 'churned', 'email']);
    expect(() => validateGenerativeTrait(trait, fields)).not.toThrow();
  });

  it('throws ModelDefinitionError when prompt is empty', () => {
    const trait = makeGenerativeTrait({ prompt: '' });
    const fields = new Set(['plan', 'churned']);
    expect(() => validateGenerativeTrait(trait, fields)).toThrowError(
      /prompt must not be empty/i
    );
  });

  it('throws ModelDefinitionError when prompt is whitespace-only', () => {
    const trait = makeGenerativeTrait({ prompt: '   ' });
    const fields = new Set(['plan', 'churned']);
    expect(() => validateGenerativeTrait(trait, fields)).toThrowError(
      /prompt must not be empty/i
    );
  });

  it('throws ModelDefinitionError when a context field is missing from schema', () => {
    const trait = makeGenerativeTrait();
    const fields = new Set(['id', 'plan']); // 'churned' missing
    expect(() => validateGenerativeTrait(trait, fields)).toThrowError(/churned/);
  });

  it('throws ModelDefinitionError when z.enum() schema has no options', () => {
    const trait = makeGenerativeTrait({
      outputSchema: { ...stubZodMethods, _def: { typeName: 'ZodEnum', values: [] } },
    });
    const fields = new Set(['plan', 'churned']);
    expect(() => validateGenerativeTrait(trait, fields)).toThrowError(/options/i);
  });

  it('passes for z.enum() with valid options', () => {
    const trait = makeGenerativeTrait({ outputSchema: zodEnum(['yes', 'no']) });
    const fields = new Set(['plan', 'churned']);
    expect(() => validateGenerativeTrait(trait, fields)).not.toThrow();
  });

  it('passes for z.object() outputSchema', () => {
    const trait = makeGenerativeTrait({ outputSchema: zodObject() });
    const fields = new Set(['plan', 'churned']);
    expect(() => validateGenerativeTrait(trait, fields)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// compileGenerativeTrait
// ---------------------------------------------------------------------------

describe('compileGenerativeTrait', () => {
  const HASH = 'sha256abc123';
  const VERSION = '0.3.1';

  it('produces a valid GenerativeArtifactMetadata object', () => {
    const trait = makeGenerativeTrait();
    const result = compileGenerativeTrait(trait, HASH, VERSION);

    expect(result.traitType).toBe('generative');
    expect(result.traitName).toBe('retentionMessage');
    expect(result.schemaHash).toBe(HASH);
    expect(result.version).toBe(VERSION);
    expect(result.metadataSchemaVersion).toBe('1.0.0');
    expect(result.contextFields).toEqual(['plan', 'churned']);
    expect(result.promptTemplate).toBe('Write a retention message for this user.');
    expect(typeof result.compiledAt).toBe('string');
  });

  it('emits text outputSchemaShape when no outputSchema provided', () => {
    const trait = makeGenerativeTrait();
    const result = compileGenerativeTrait(trait, HASH, VERSION);
    expect(result.outputSchemaShape).toBe('text');
    expect(result.choiceOptions).toBeUndefined();
  });

  it('emits choice outputSchemaShape with options for z.enum()', () => {
    const trait = makeGenerativeTrait({
      outputSchema: zodEnum(['approve', 'deny']),
    });
    const result = compileGenerativeTrait(trait, HASH, VERSION);
    expect(result.outputSchemaShape).toBe('choice');
    expect(result.choiceOptions).toEqual(['approve', 'deny']);
  });

  it('emits object outputSchemaShape for z.object()', () => {
    const trait = makeGenerativeTrait({ outputSchema: zodObject() });
    const result = compileGenerativeTrait(trait, HASH, VERSION);
    expect(result.outputSchemaShape).toBe('object');
  });

  it('compiledAt is a valid ISO timestamp', () => {
    const trait = makeGenerativeTrait();
    const result = compileGenerativeTrait(trait, HASH, VERSION);
    expect(new Date(result.compiledAt).toString()).not.toBe('Invalid Date');
  });

  it('contextFields is a copy (not mutated by trait)', () => {
    const context = ['plan', 'churned'];
    const trait = makeGenerativeTrait({ context });
    const result = compileGenerativeTrait(trait, HASH, VERSION);
    context.push('email');
    expect(result.contextFields).toEqual(['plan', 'churned']);
  });
});

// ---------------------------------------------------------------------------
// isGenerativeArtifact type guard
// ---------------------------------------------------------------------------

describe('isGenerativeArtifact (from artifacts.ts)', () => {
  it('narrows artifact to GenerativeArtifactMetadata', async () => {
    const { isGenerativeArtifact } = await import('./artifacts');
    const artifact: GenerativeArtifactMetadata = {
      traitType: 'generative',
      artifactFormat: 'json',
      traitName: 'retentionMessage',
      schemaHash: 'abc',
      compiledAt: new Date().toISOString(),
      version: '0.3.1',
      metadataSchemaVersion: '1.0.0',
      contextFields: ['plan'],
      promptTemplate: 'Write something.',
      outputSchemaShape: 'text',
    };
    expect(isGenerativeArtifact(artifact as any)).toBe(true);
    expect(isGenerativeArtifact({ traitType: 'predictive' } as any)).toBe(false);
    expect(isGenerativeArtifact({ traitType: 'anomaly' } as any)).toBe(false);
  });
});
