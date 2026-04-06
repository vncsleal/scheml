/**
 * Feature Extraction via AST Analysis
 * Conservative static analysis of feature resolver source.
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

function parseParameterNames(sourceCode: string): string[] {
  const arrowMatch = sourceCode.match(/^\s*(?:async\s*)?\(?\s*([^)=]*)\s*\)?\s*=>/);
  if (arrowMatch) {
    return arrowMatch[1]
      .split(',')
      .map((parameter) => parameter.trim())
      .filter(Boolean)
      .map((parameter) => parameter.replace(/^[{\[]|[}\]]$/g, '').trim())
      .filter((parameter) => /^[A-Za-z_$][\w$]*$/.test(parameter));
  }

  const functionMatch = sourceCode.match(/function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/);
  if (!functionMatch) {
    return [];
  }

  return functionMatch[1]
    .split(',')
    .map((parameter) => parameter.trim())
    .filter((parameter) => /^[A-Za-z_$][\w$]*$/.test(parameter));
}

function extractAccessPaths(sourceCode: string, parameterName: string): AccessPath[] {
  const memberPattern = new RegExp(
    `\\b${parameterName}(?:(?:\\?\\.|\\.)[A-Za-z_$][\\w$]*)+`,
    'g'
  );
  const matches = sourceCode.match(memberPattern) ?? [];
  const seen = new Set<string>();
  const accessPaths: AccessPath[] = [];

  for (const match of matches) {
    const isOptional = match.includes('?.');
    const rawSegments = match.replace(new RegExp(`^${parameterName}`), '').split(/\?|\./).filter(Boolean);
    const isArrayLength = rawSegments[rawSegments.length - 1] === 'length';
    const segments = isArrayLength ? rawSegments.slice(0, -1) : rawSegments;

    if (segments.length === 0) {
      continue;
    }

    const key = `${segments.join('.')}|${isOptional}|${isArrayLength}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    accessPaths.push({
      segments,
      isOptional,
      isArrayLength,
    });
  }

  return accessPaths;
}

function detectUnsupportedPatterns(sourceCode: string, parameterNames: string[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  for (const parameterName of parameterNames) {
    if (new RegExp(`\\b${parameterName}\\s*\\[`).test(sourceCode)) {
      issues.push({
        severity: 'warning',
        code: 'DYNAMIC_ACCESS',
        message: `Dynamic property access on "${parameterName}" may require runtime extraction.`,
      });
    }

    if (new RegExp(`\\b${parameterName}(?:(?:\\?\\.|\\.)[A-Za-z_$][\\w$]*)+\\s*\\(`).test(sourceCode)) {
      issues.push({
        severity: 'warning',
        code: 'METHOD_CALL',
        message: `Method calls on "${parameterName}" are not statically expanded into field dependencies.`,
      });
    }
  }

  return issues;
}

/**
 * Analyze a feature resolver function for static extractability.
 */
export function analyzeFeatureResolver(
  sourceCode: string,
  functionName?: string
): FeatureAnalysis {
  const parameterNames = parseParameterNames(sourceCode);
  const accessPaths = parameterNames.flatMap((parameterName) =>
    extractAccessPaths(sourceCode, parameterName)
  );
  const issues = detectUnsupportedPatterns(sourceCode, parameterNames);

  return {
    name: functionName || 'resolver',
    isExtractable: issues.length === 0,
    accessPaths,
    issues,
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
        current = (current as Record<string, unknown>)[segment];
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

