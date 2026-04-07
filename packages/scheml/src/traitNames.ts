import * as path from 'path';

const VALID_TRAIT_NAME = /^[a-zA-Z0-9_-]+$/;

export function sanitizeTraitFileComponent(traitName: string): string {
  const safeName = path.basename(String(traitName).trim()).replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!safeName) {
    throw new Error('Trait name must not be empty.');
  }
  return safeName;
}

export function assertValidTraitName(traitName: string): string {
  if (!VALID_TRAIT_NAME.test(traitName)) {
    throw new Error(
      `Invalid trait name "${traitName}". Names must contain only letters, numbers, underscores, and hyphens.`
    );
  }
  return traitName;
}