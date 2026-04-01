/**
 * scheml check command
 * Validates schema-only contract compatibility for trained models and traits.
 *
 * Handles both:
 *   - Legacy `ModelMetadata` artifacts (field: `prismaSchemaHash`)
 *   - New trait `ArtifactMetadata` artifacts (field: `traitType` + `schemaHash`)
 *
 * Flags:
 *   --json   Suppress chalk/ora output and print structured JSON to stdout.
 *            Shape: { ok: boolean, errors: string[], warnings: string[], drift: SchemaDelta[] }
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import {
  ModelMetadata,
  hashPrismaModelSubset,
  parseModelSchema,
} from '..';
import { computeSchemaHashForMetadata } from '../contracts';
import { PrismaSchemaReader } from '../adapters/prisma';
import type { ArtifactMetadata } from '../artifacts';
import { checkArtifactDrift, type SchemaDelta } from '../drift';
import { appendHistoryRecord, detectAuthor, readLatestHistoryRecord } from '../history';
import { checkFeedbackDecay, type AccuracyDecayResult } from '../feedback';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadMetadataFiles(outputDir: string, model?: string): string[] {
  if (!fs.existsSync(outputDir)) {
    throw new Error(`Output directory not found: ${outputDir}`);
  }

  const entries = fs.readdirSync(outputDir);
  const metadataFiles = entries.filter((file) => file.endsWith('.metadata.json'));

  if (model) {
    const match = `${model}.metadata.json`;
    if (!metadataFiles.includes(match)) {
      throw new Error(`Metadata not found for model "${model}" in ${outputDir}`);
    }
    return [path.join(outputDir, match)];
  }

  return metadataFiles.map((file) => path.join(outputDir, file));
}

function readRawMetadata(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function isTraitArtifact(m: any): m is ArtifactMetadata {
  return (
    m &&
    typeof m.traitType === 'string' &&
    ['predictive', 'anomaly', 'similarity', 'sequential', 'generative'].includes(m.traitType)
  );
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const checkCommand = {
  command: 'check',
  description: 'Validate schema-only contract compatibility',
  builder: (yargs: Argv) => {
    return yargs
      .option('schema', {
        alias: 's',
        description: 'Path to Prisma schema',
        type: 'string',
        default: './prisma/schema.prisma',
      })
      .option('output', {
        alias: 'o',
        description: 'Output directory for models',
        type: 'string',
        default: './.scheml',
      })
      .option('model', {
        alias: 'm',
        description: 'Single model name to validate',
        type: 'string',
      })
      .option('json', {
        description: 'Emit structured JSON instead of human-readable output',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: any) => {
    const schemaPath = path.resolve(argv.schema);
    const outputDir = path.resolve(argv.output);
    const modelFilter = argv.model as string | undefined;
    const jsonMode = argv.json as boolean;

    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    const schemaContent = graph.rawSource;
    const metadataPaths = loadMetadataFiles(outputDir, modelFilter);

    const errors: string[] = [];
    const warnings: string[] = [];
    const drift: SchemaDelta[] = [];
    const feedback: AccuracyDecayResult[] = [];

    for (const metadataPath of metadataPaths) {
      const raw = readRawMetadata(metadataPath);

      // -----------------------------------------------------------------------
      // New trait artifacts — route by traitType
      // -----------------------------------------------------------------------
      if (isTraitArtifact(raw)) {
        const metadata = raw as ArtifactMetadata;

        if (!metadata.entityName) {
          warnings.push(
            `${metadata.traitName}: Missing entityName in metadata — schema drift check skipped.`
          );
          continue;
        }

        const currentFields = parseModelSchema(schemaContent, metadata.entityName);
        const currentHash = hashPrismaModelSubset(schemaContent, metadata.entityName);
        const delta = checkArtifactDrift(metadata, currentHash, currentFields);

        if (delta.hasDrift) {
          drift.push(delta);
          const removedMsg =
            delta.removed?.length
              ? ` Removed fields (breaking): ${delta.removed.join(', ')}.`
              : '';
          const addedMsg =
            delta.added?.length
              ? ` Added fields in schema: ${delta.added.join(', ')}.`
              : '';
          warnings.push(
            `${metadata.traitName}: Schema drift detected since last training.${removedMsg}${addedMsg}`
          );

          // Write a drift history record
          const latest = readLatestHistoryRecord(outputDir, metadata.traitName);
          appendHistoryRecord(outputDir, {
            trait: metadata.traitName,
            model: metadata.entityName,
            adapter: 'prisma',
            schemaHash: metadata.schemaHash,
            definedAt: latest?.definedAt ?? new Date().toISOString(),
            definedBy: latest?.definedBy ?? detectAuthor(),
            trainedAt: latest?.trainedAt,
            artifactVersion: latest?.artifactVersion ?? '0',
            status: 'drifted',
            driftDetectedAt: new Date().toISOString(),
            driftFields: [...(delta.removed ?? []), ...(delta.added ?? [])],
          });
        }

        // Check feedback-based accuracy decay against quality gates
        const decayResult = checkFeedbackDecay(outputDir, metadata.traitName, metadata.qualityGates);
        if (decayResult) {
          feedback.push(decayResult);
          if (decayResult.belowThreshold) {
            warnings.push(
              `${metadata.traitName}: Feedback accuracy decay detected — ` +
              `${decayResult.metric} ${decayResult.rmse !== undefined ? decayResult.rmse.toFixed(4) : (decayResult.accuracy! * 100).toFixed(1) + '%'} ` +
              `does not meet quality gate (${decayResult.metric} ${metadata.qualityGates?.find((g) => g.metric === decayResult.metric)?.comparison ?? ''} ${decayResult.threshold ?? ''}). ` +
              `Based on ${decayResult.pairedCount} paired observations.`
            );
          }
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // Legacy ModelMetadata artifacts
      // -----------------------------------------------------------------------
      const metadata = raw as ModelMetadata;
      const deps = metadata.featureDependencies || [];

      if (!deps.length) {
        warnings.push(
          `${metadata.modelName}: No featureDependencies found in metadata (schema-only check skipped).`
        );
        continue;
      }

      const modelNames = new Set(deps.map((dep) => dep.modelName));
      for (const modelName of modelNames) {
        const entity = graph.entities.get(modelName);

        deps
          .filter((dep) => dep.modelName === modelName)
          .forEach((dep) => {
            if (!dep.extractable) {
              warnings.push(
                `${metadata.modelName}: ${dep.path} is dynamic and cannot be statically validated.`
              );
              return;
            }

            const fieldName = dep.path.split('.').slice(1).join('.') || dep.path;
            const schemaField = entity?.fields[fieldName];

            if (!schemaField) {
              errors.push(
                `${metadata.modelName}: Missing field ${dep.path} in Prisma schema.`
              );
              return;
            }

            const expectedType = dep.scalarType;
            const actualType = schemaField.scalarType;
            if (expectedType !== 'unknown' && actualType !== expectedType) {
              errors.push(
                `${metadata.modelName}: ${dep.path} type mismatch (${actualType} != ${expectedType}).`
              );
            }

            if (dep.nullable !== schemaField.nullable) {
              errors.push(
                `${metadata.modelName}: ${dep.path} nullability mismatch (schema nullable=${schemaField.nullable}).`
              );
            }
          });
      }

      const expectedSchemaHash = computeSchemaHashForMetadata(graph.rawSource, metadata);
      if (metadata.prismaSchemaHash !== expectedSchemaHash) {
        warnings.push(
          `${metadata.modelName}: Prisma schema hash differs from metadata (hash mismatch).`
        );
      }
    }

    const ok = errors.length === 0;

    // -----------------------------------------------------------------------
    // JSON output mode
    // -----------------------------------------------------------------------
    if (jsonMode) {
      process.stdout.write(
        JSON.stringify({ ok, errors, warnings, drift, feedback }) + '\n'
      );
      if (!ok) throw new Error('Schema-only contract check failed.');
      return;
    }

    // -----------------------------------------------------------------------
    // Human-readable output
    // -----------------------------------------------------------------------
    if (warnings.length) {
      console.log(chalk.yellow('\nWarnings:'));
      warnings.forEach((warning) => console.log(chalk.yellow(`  - ${warning}`)));
    }

    if (errors.length) {
      console.log(chalk.red('\nErrors:'));
      errors.forEach((error) => console.log(chalk.red(`  - ${error}`)));
      throw new Error('Schema-only contract check failed.');
    }

    if (drift.length) {
      console.log(chalk.yellow(`\n[DRIFT] ${drift.length} artifact(s) have schema drift — re-train is recommended.`));
    } else {
      console.log(chalk.green('\n[OK] Schema-only contract check passed.'));
    }
  },
};

