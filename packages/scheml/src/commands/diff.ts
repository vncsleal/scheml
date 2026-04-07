/**
 * scheml diff — compare two artifact history records for a trait.
 *
 * By default compares the latest record against the one before it.
 *
 * Usage:
 *   scheml diff <trait>
 *   scheml diff <trait> --json
 */

import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import { readHistoryRecords, type HistoryRecord } from '../history';
import { assertValidTraitName } from '../traitNames';

type DiffCommandArgs = {
  trait?: string;
  output: string;
  json?: boolean;
};

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

type ChangedField = { field: string; from: unknown; to: unknown };

/** Fields worth surfacing in a diff (most useful, not entire record). */
const DIFF_FIELDS: (keyof HistoryRecord)[] = [
  'schemaHash',
  'artifactVersion',
  'status',
  'trainedAt',
  'driftDetectedAt',
  'driftFields',
];

function detectChanges(from: HistoryRecord, to: HistoryRecord): ChangedField[] {
  const changes: ChangedField[] = [];
  for (const field of DIFF_FIELDS) {
    const a = from[field];
    const b = to[field];
    const aStr = JSON.stringify(a);
    const bStr = JSON.stringify(b);
    if (aStr !== bStr) {
      changes.push({ field, from: a, to: b });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Human-readable display
// ---------------------------------------------------------------------------

function formatValue(v: unknown): string {
  if (v === undefined) return chalk.dim('(none)');
  if (Array.isArray(v)) return v.join(', ') || chalk.dim('(empty)');
  return String(v);
}

function printDiff(
  traitName: string,
  from: HistoryRecord | null,
  to: HistoryRecord | null,
  changes: ChangedField[]
): void {
  console.log('');
  console.log(chalk.bold.cyan(`  Diff: ${traitName}`));
  console.log(chalk.dim('  ' + '─'.repeat(48)));

  if (!from || !to) {
    const note = !from && !to
      ? 'No history records found for this trait'
      : !from
      ? 'Only one history record found — nothing to compare'
      : 'Could not locate target record';
    console.log(chalk.yellow(`  ⚠  ${note}`));
    console.log('');
    return;
  }

  console.log(`  ${chalk.dim('From')}: v${from.artifactVersion}  ${chalk.dim(from.definedAt)}`);
  console.log(`  ${chalk.dim('To')}  : v${to.artifactVersion}  ${chalk.dim(to.definedAt)}`);
  console.log('');

  if (changes.length === 0) {
    console.log(chalk.green('  ✓ No changes between these two records'));
    console.log('');
    return;
  }

  console.log(chalk.bold('  Changes'));
  console.log(chalk.dim('  ' + '─'.repeat(48)));
  for (const c of changes) {
    console.log(
      `  ${chalk.dim(c.field.padEnd(18))}` +
        `  ${chalk.red(formatValue(c.from))}` +
        chalk.dim(' → ') +
        chalk.green(formatValue(c.to))
    );
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const diffCommand = {
  command: 'diff <trait>',
  description: 'Compare two artifact history records for a trait (default: latest vs previous)',
  builder: (yargs: Argv) =>
    yargs
      .positional('trait', {
        description: 'Trait name to diff',
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

  handler: async (argv: DiffCommandArgs) => {
    if (typeof argv.trait !== 'string' || argv.trait.length === 0) {
      throw new Error('Trait name is required. Usage: scheml diff <trait>');
    }

    const traitName = assertValidTraitName(argv.trait);
    const outputDir = path.resolve(argv.output);
    const jsonMode = argv.json ?? false;

    const records = readHistoryRecords(outputDir, traitName);

    // Diff latest vs previous
    const to = records.length >= 1 ? records[records.length - 1] : null;
    const from = records.length >= 2 ? records[records.length - 2] : null;

    const changes = from && to ? detectChanges(from, to) : [];

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: true, trait: traitName, from, to, changes }) + '\n');
      return;
    }

    printDiff(traitName, from, to, changes);
  },
};
