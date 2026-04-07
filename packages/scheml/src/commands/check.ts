/**
 * scheml check command
 * Validates schema-only contract compatibility for trained models and traits.
 *
 * Flags:
 *   --json   Suppress chalk/ora output and print structured JSON to stdout.
 *            Shape: { ok: boolean, errors: string[], warnings: string[], drift: SchemaDelta[] }
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import { createJiti } from 'jiti';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { resolveConfiguredAdapter, resolveSchemaPath } from '../adapterResolution';
import { checkArtifactDrift, type SchemaDelta, type SchemaSnapshot } from '../drift';
import { appendHistoryRecord, detectAuthor, readLatestHistoryRecord } from '../history';
import { checkFeedbackDecay, type AccuracyDecayResult } from '../feedback';
import { parseArtifactMetadata } from '../artifacts';
import { normalizeConfigExports } from './configHelpers';

interface CheckArgs {
  config?: string;
  schema?: string;
  output?: string;
  trait?: string;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

async function loadConfigModule(configPath: string) {
  const jiti = createJiti(pathToFileURL(__filename).href, { interopDefault: true });
  return normalizeConfigExports((await jiti.import(configPath)) as ReturnType<typeof normalizeConfigExports>);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadMetadataFiles(outputDir: string, trait?: string): string[] {
  if (!fs.existsSync(outputDir)) {
    throw new Error(`Output directory not found: ${outputDir}`);
  }

  const entries = fs.readdirSync(outputDir);
  const metadataFiles = entries.filter((file) => file.endsWith('.metadata.json'));

  if (trait) {
    const match = `${trait}.metadata.json`;
    if (!metadataFiles.includes(match)) {
      throw new Error(`Metadata not found for trait "${trait}" in ${outputDir}`);
    }
    return [path.join(outputDir, match)];
  }

  return metadataFiles.map((file) => path.join(outputDir, file));
}

function readRawMetadata(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const checkCommand = {
  command: 'check',
  description: 'Validate schema-only contract compatibility',
  builder: (yargs: Argv) => {
    return yargs
      .option('config', {
        alias: 'c',
        description: 'Path to scheml.config.ts',
        type: 'string',
        default: './scheml.config.ts',
      })
      .option('schema', {
        alias: 's',
        description: 'Path to schema source file (overrides scheml.config.ts schema field)',
        type: 'string',
      })
      .option('output', {
        alias: 'o',
        description: 'Output directory for models',
        type: 'string',
        default: './.scheml',
      })
      .option('trait', {
        alias: 't',
        description: 'Single trait name to validate',
        type: 'string',
      })
      .option('json', {
        description: 'Emit structured JSON instead of human-readable output',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: CheckArgs) => {
    const configPath = path.resolve(argv.config ?? './scheml.config.ts');
    const config = await loadConfigModule(configPath);

    const schemaSource = resolveSchemaPath(config.schema, argv.schema);
    if (!schemaSource && typeof config.adapter === 'string') {
      throw new Error(
        'Schema path not configured. Set schema in scheml.config.ts or pass --schema <path>.'
      );
    }
    const schemaPath = schemaSource ? path.resolve(schemaSource) : undefined;

    const adapter = resolveConfiguredAdapter(config.adapter);
    const adapterName = adapter.name;

    const outputDir = path.resolve(argv.output ?? './.scheml');
    const traitFilter = argv.trait;
    const jsonMode = argv.json ?? false;

    const reader = adapter.reader;
    const graph = await reader.readSchema(schemaPath ?? '');
    const metadataPaths = loadMetadataFiles(outputDir, traitFilter);

    const errors: string[] = [];
    const warnings: string[] = [];
    const drift: SchemaDelta[] = [];
    const feedback: AccuracyDecayResult[] = [];

    for (const metadataPath of metadataPaths) {
      const raw = readRawMetadata(metadataPath);
      if (raw === null) {
        warnings.push(`${metadataPath}: Failed to parse metadata file — skipping.`);
        continue;
      }

      const metadata = parseArtifactMetadata(raw);
      if (!metadata) {
        warnings.push(`${metadataPath}: Metadata is not a supported artifact format — skipping.`);
        continue;
      }

      if (!metadata.entityName) {
        warnings.push(
          `${metadata.traitName}: Missing entityName in metadata — schema drift check skipped.`
        );
        continue;
      }

      const entity = graph.entities.get(metadata.entityName);
      if (!entity) {
        warnings.push(
          `${metadata.traitName}: Entity "${metadata.entityName}" was not found in the current schema.`
        );
        drift.push({
          traitName: metadata.traitName,
          storedHash: metadata.schemaHash,
          currentHash: 'missing-entity',
          hasDrift: true,
          added: [],
          removed: metadata.traitType === 'predictive' ? metadata.features.order : [],
        });
        continue;
      }

      const currentFields: SchemaSnapshot = Object.fromEntries(
        Object.entries(entity.fields).map(([key, field]) => [key, { type: field.scalarType, optional: field.nullable }])
      );
      const currentHash = reader.hashModel(graph, metadata.entityName);
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

        const latest = readLatestHistoryRecord(outputDir, metadata.traitName);
        appendHistoryRecord(outputDir, {
          trait: metadata.traitName,
          model: metadata.entityName,
          adapter: adapterName,
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

      const decayResult = checkFeedbackDecay(outputDir, metadata.traitName, metadata.qualityGates);
      if (decayResult) {
        feedback.push(decayResult);
        if (decayResult.belowThreshold) {
          warnings.push(
            `${metadata.traitName}: Feedback accuracy decay detected — ` +
            `${decayResult.metric} ${decayResult.rmse !== undefined ? decayResult.rmse.toFixed(4) : (decayResult.accuracy! * 100).toFixed(1) + '%'} ` +
            `does not meet quality gate (${decayResult.metric} ${metadata.qualityGates?.find((gate) => gate.metric === decayResult.metric)?.comparison ?? ''} ${decayResult.threshold ?? ''}). ` +
            `Based on ${decayResult.pairedCount} paired observations.`
          );
        }
      }
    }

    const ok = errors.length === 0 && drift.length === 0;

    // -----------------------------------------------------------------------
    // JSON output mode
    // -----------------------------------------------------------------------
    if (jsonMode) {
      process.stdout.write(
        JSON.stringify({ ok, errors, warnings, drift, feedback }) + '\n'
      );
      if (!ok) {
        throw new Error('Schema-only contract check failed.');
      }
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
      throw new Error('Schema-only contract check failed.');
    }

    console.log(chalk.green('\n[OK] Schema-only contract check passed.'));
  },
};

