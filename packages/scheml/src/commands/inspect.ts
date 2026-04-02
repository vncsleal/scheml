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
import type { ArtifactMetadata } from '../artifacts';
import { readLatestHistoryRecord } from '../history';
import { readFeedbackRecords } from '../feedback';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function metadataPath(outputDir: string, traitName: string): string {
  return path.join(outputDir, `${traitName}.metadata.json`);
}

function loadMetadata(outputDir: string, traitName: string): ArtifactMetadata | null {
  const file = metadataPath(outputDir, traitName);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ArtifactMetadata;
  } catch {
    return null;
  }
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
        const split = (m as unknown as Record<string, unknown>).split ?? 'test';
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
      const op = (gate as unknown as Record<string, unknown>).operator ?? '>=';
      const threshold = (gate as unknown as Record<string, unknown>).threshold;
      const metric = (gate as unknown as Record<string, unknown>).metric ?? gate;
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

  handler: async (argv: any) => {
    const traitName = argv.trait as string;
    const outputDir = path.resolve(argv.output as string);
    const jsonMode = argv.json as boolean;

    const meta = loadMetadata(outputDir, traitName);

    if (!meta) {
      const err = { ok: false, error: `No artifact found for trait "${traitName}" in ${outputDir}` };
      if (jsonMode) {
        console.log(JSON.stringify(err, null, 2));
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
      console.log(
        JSON.stringify(
          {
            ok: true,
            trait: traitName,
            metadata: meta,
            history,
            feedbackCount,
          },
          null,
          2
        )
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
