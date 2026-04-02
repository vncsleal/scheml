/**
 * Feature Extraction via AST Analysis
 * Conservative static analysis of feature resolvers
 *
 * NOTE: This module is currently stubbed out.
 * Advanced AST analysis is out of scope for MVP.
 * Feature extraction is currently done via runtime evaluation.
 */

/**
 * Represents an access path in a feature resolver
 */
export interface AccessPath {
  segments: string[];
  isOptional: boolean;
  isArrayLength: boolean;
}

/**
 * Result of analyzing a feature resolver
 */
export interface FeatureAnalysis {
  name: string;
  isExtractable: boolean;
  accessPaths: AccessPath[];
  issues: AnalysisIssue[];
}

/**
 * Analysis issue or warning
 */
export interface AnalysisIssue {
  severity: 'error' | 'warning';
  message: string;
  code: string;
}

/**
 * Analyze a feature resolver function for static extractability
 * @stub Out of scope for MVP - returns basic analysis
 */
export function analyzeFeatureResolver(
  sourceCode: string,
  functionName?: string
): FeatureAnalysis {
  return {
    name: functionName || 'resolver',
    isExtractable: true,
    accessPaths: [],
    issues: [
      {
        severity: 'warning',
        message:
          'AST analysis is out of scope for MVP. Feature extraction uses runtime evaluation.',
        code: 'MVP_SCOPE',
      },
    ],
  };
}

/**
 * Validate hydration: check if all required access paths are present in entity type
 */
export function validateHydration(
  accessPaths: AccessPath[],
  entityType: Record<string, unknown>,
  allowNull: Set<string> = new Set()
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const path of accessPaths) {
    let current: unknown = entityType;
    let fullPath = '';

    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];
      fullPath = fullPath ? `${fullPath}.${segment}` : segment;

      if (current === undefined) {
        errors.push(`Required path ${fullPath} is undefined`);
        break;
      }

      if (current === null) {
        if (!allowNull.has(fullPath)) {
          errors.push(`Path ${fullPath} is null but not declared nullable`);
        }
        break;
      }

      if (typeof current === 'object' && current !== null) {
        if (!(segment in (current as Record<string, unknown>))) {
          if (!path.isOptional) {
            // Report the full access path so callers know which path was being resolved.
            errors.push(`Required path ${path.segments.join('.')} is missing`);
          }
          current = undefined;
          break;
        }
        current = (current as any)[segment];
      } else {
        if (!path.isOptional) {
          errors.push(`Cannot access ${segment} on non-object at ${fullPath}`);
        }
        break;
      }
    }

    if (path.isArrayLength && current !== undefined && !Array.isArray(current)) {
      errors.push(`Path ${fullPath} is not an array, cannot access .length`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

