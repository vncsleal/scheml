/**
 * scheml audit command
 * Exports full history records for all traits in a verifiable JSON shape.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import { historyDir, readHistoryRecords, type HistoryRecord } from '../history';
import { assertValidTraitName } from '../traitNames';

type AuditCommandArgs = {
  output: string;
  trait?: string;
  json?: boolean;
};

function listTraits(outputDir: string): string[] {
  const dir = historyDir(outputDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace(/\.jsonl$/, ''))
    .sort();
}

function aggregate(records: HistoryRecord[]): {
  trained: number;
  drifted: number;
  materialized: number;
} {
  return {
    trained: records.filter((r) => r.status === 'trained').length,
    drifted: records.filter((r) => r.status === 'drifted').length,
    materialized: records.filter((r) => r.status === 'materialized').length,
  };
}

export const auditCommand = {
  command: 'audit',
  description: 'Export full trait history as structured JSON',
  builder: (yargs: Argv) => {
    return yargs
      .option('output', {
        alias: 'o',
        description: 'Output directory for artifacts/history',
        type: 'string',
        default: './.scheml',
      })
      .option('trait', {
        description: 'Optional single trait filter',
        type: 'string',
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: AuditCommandArgs) => {
    const outputDir = path.resolve(argv.output);
    const traitFilter = argv.trait;
    const jsonMode = argv.json ?? false;

    const traits = traitFilter ? [assertValidTraitName(traitFilter)] : listTraits(outputDir);
    const history = traits.map((trait) => ({
      trait,
      records: readHistoryRecords(outputDir, trait),
    }));

    const flatRecords = history.flatMap((item) => item.records);
    const totals = aggregate(flatRecords);

    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      traitCount: history.length,
      recordCount: flatRecords.length,
      totals,
      traits: history,
    };

    if (jsonMode) {
      process.stdout.write(JSON.stringify(payload) + '\n');
      return;
    }

    if (history.length === 0) {
      console.log(chalk.yellow('No history records found.'));
      return;
    }

    console.log(chalk.cyan('\nScheML Audit'));
    console.log(chalk.dim(`Traits: ${payload.traitCount}`));
    console.log(chalk.dim(`Records: ${payload.recordCount}`));
    console.log(
      chalk.dim(
        `Trained=${totals.trained}  Drifted=${totals.drifted}  Materialized=${totals.materialized}`
      )
    );

    for (const item of history) {
      const latest = item.records[item.records.length - 1];
      console.log(
        `  ${item.trait}: ${item.records.length} record(s)` +
          (latest ? `, latest=${latest.status}` : '')
      );
    }
  },
};
