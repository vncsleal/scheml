/**
 * scheml inspect — show detailed information about a trained trait artifact.
 *
 * Usage:
 *   scheml inspect <trait>
 *   scheml inspect <trait> --json
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import { metadataFileName, parseArtifactMetadata, type ArtifactMetadata } from '../artifacts';
import { readLatestHistoryRecord } from '../history';
import { readFeedbackRecords } from '../feedback';
import { assertValidTraitName } from '../traitNames';

interface InspectArgs {
  trait?: string;
  output?: string;
  json?: boolean;
}

type MetricRecord = Record<string, string | number | boolean | null | undefined> & {
  split?: string;
};

type QualityGateRecord = {
  metric?: string;
  operator?: string;
  threshold?: string | number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function metadataPath(outputDir: string, traitName: string): string {
  return path.join(outputDir, metadataFileName(traitName));
}

function loadMetadata(outputDir: string, traitName: string): ArtifactMetadata | null {
  const file = metadataPath(outputDir, traitName);
  if (!fs.existsSync(file)) return null;
  try {
    return parseArtifactMetadata(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
}

function asMetricRecord(value: unknown): MetricRecord | null {
  return value && typeof value === 'object' ? (value as MetricRecord) : null;
}

function asQualityGateRecord(value: unknown): QualityGateRecord | null {
  return value && typeof value === 'object' ? (value as QualityGateRecord) : null;
}

// ---------------------------------------------------------------------------
// Human-readable display
// ---------------------------------------------------------------------------

function printInspect(traitName: string, meta: ArtifactMetadata, feedbackCount: number): void {
  console.log('');
  console.log(chalk.bold.cyan(`  Trait: ${traitName}`));
  console.log(chalk.dim('  ' + '─'.repeat(48)));

  const base = [
    ['Type', meta.traitType],
    ['Entity', meta.entityName ?? chalk.dim('(none)')],
    ['Schema hash', meta.schemaHash],
    ['Compiled at', meta.compiledAt],
    ['Version', meta.version],
    ['Metadata schema', meta.metadataSchemaVersion],
  ] as const;

  for (const [label, value] of base) {
    console.log(`  ${chalk.dim(label.padEnd(18))} ${value}`);
  }

  // Predictive-specific
  if (meta.traitType === 'predictive') {
    console.log('');
    console.log(chalk.bold('  Model'));
    console.log(chalk.dim('  ' + '─'.repeat(48)));
    console.log(`  ${chalk.dim('Algorithm'.padEnd(18))} ${meta.bestEstimator}`);
    console.log(`  ${chalk.dim('Task type'.padEnd(18))} ${meta.taskType}`);
    console.log(`  ${chalk.dim('Output field'.padEnd(18))} ${meta.output.field}`);

    const features = meta.features.order ?? [];
    console.log(`  ${chalk.dim('Features'.padEnd(18))} ${features.length} (${features.slice(0, 5).join(', ')}${features.length > 5 ? `, +${features.length - 5} more` : ''})`);

    if (meta.trainingMetrics && meta.trainingMetrics.length > 0) {
      console.log('');
      console.log(chalk.bold('  Training Metrics'));
      console.log(chalk.dim('  ' + '─'.repeat(48)));
      for (const m of meta.trainingMetrics) {
        const entries = Object.entries(m).filter(([k]) => k !== 'split');
        const formatted = entries.map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(4) : v}`).join('  ');
        const split = asMetricRecord(m)?.split ?? 'test';
        console.log(`  ${chalk.dim(String(split).padEnd(18))} ${formatted}`);
      }
    }
  }

  // Quality gates
  if (meta.qualityGates && meta.qualityGates.length > 0) {
    console.log('');
    console.log(chalk.bold('  Quality Gates'));
    console.log(chalk.dim('  ' + '─'.repeat(48)));
    for (const gate of meta.qualityGates) {
      const qualityGate = asQualityGateRecord(gate);
      const op = qualityGate?.operator ?? '>=';
      const threshold = qualityGate?.threshold;
      const metric = qualityGate?.metric ?? gate;
      console.log(`  ${chalk.dim(String(metric).padEnd(18))} ${op} ${threshold}`);
    }
  }

  // Feedback
  console.log('');
  console.log(chalk.bold('  Feedback'));
  console.log(chalk.dim('  ' + '─'.repeat(48)));
  console.log(`  ${chalk.dim('Paired samples'.padEnd(18))} ${feedbackCount}`);

  console.log('');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const inspectCommand = {
  command: 'inspect <trait>',
  description: 'Show detailed information about a trained trait artifact',
  builder: (yargs: Argv) =>
    yargs
      .positional('trait', {
        description: 'Trait name to inspect',
        type: 'string',
      })
      .option('output', {
        alias: 'o',
        description: 'Output directory for artifacts',
        type: 'string',
        default: './.scheml',
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      }),

  handler: async (argv: InspectArgs) => {
    if (typeof argv.trait !== 'string' || argv.trait.length === 0) {
      throw new Error('Trait name is required. Usage: scheml inspect <trait>');
    }

    const traitName = assertValidTraitName(argv.trait);
    const outputDir = path.resolve(argv.output ?? './.scheml');
    const jsonMode = argv.json ?? false;

    const meta = loadMetadata(outputDir, traitName);

    if (!meta) {
      const err = { ok: false, error: `No artifact found for trait "${traitName}" in ${outputDir}` };
      if (jsonMode) {
        process.stdout.write(JSON.stringify(err) + '\n');
      } else {
        console.error(chalk.red(`  ✗ No artifact found for trait "${traitName}"`));
        console.error(chalk.dim(`    Looked in: ${outputDir}`));
      }
      process.exit(1);
    }

    const history = readLatestHistoryRecord(outputDir, traitName);
    const feedbackRecords = readFeedbackRecords(outputDir, traitName);
    const feedbackCount = feedbackRecords.length;

    if (jsonMode) {
      process.stdout.write(
        JSON.stringify({ ok: true, trait: traitName, metadata: meta, history, feedbackCount }) + '\n'
      );
      return;
    }

    printInspect(traitName, meta, feedbackCount);

    if (history) {
      console.log(chalk.bold('  History (latest)'));
      console.log(chalk.dim('  ' + '─'.repeat(48)));
      console.log(`  ${chalk.dim('Status'.padEnd(18))} ${history.status}`);
      console.log(`  ${chalk.dim('Artifact v'.padEnd(18))} ${history.artifactVersion}`);
      if (history.trainedAt) {
        console.log(`  ${chalk.dim('Trained at'.padEnd(18))} ${history.trainedAt}`);
      }
      if (history.driftDetectedAt) {
        console.log(`  ${chalk.dim('Drift at'.padEnd(18))} ${chalk.yellow(history.driftDetectedAt)}`);
      }
      if (history.driftFields && history.driftFields.length > 0) {
        console.log(`  ${chalk.dim('Drift fields'.padEnd(18))} ${chalk.yellow(history.driftFields.join(', '))}`);
      }
      console.log('');
    }
  },
};
