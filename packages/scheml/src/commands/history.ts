/**
 * scheml history command
 * Shows trait history records from `.scheml/history/*.jsonl`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import { historyDir, readHistoryRecords, type HistoryRecord } from '../history';

function listTraitsWithHistory(outputDir: string): string[] {
  const dir = historyDir(outputDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace(/\.jsonl$/, ''))
    .sort();
}

function renderRecordLine(record: HistoryRecord): string {
  const when = record.trainedAt ?? record.definedAt;
  const driftInfo = record.driftFields?.length ? ` driftFields=${record.driftFields.join(',')}` : '';
  return `${when}  status=${record.status}  version=${record.artifactVersion}  by=${record.definedBy}${driftInfo}`;
}

export const historyCommand = {
  command: 'history',
  description: 'Show trait history records',
  builder: (yargs: Argv) => {
    return yargs
      .option('output', {
        alias: 'o',
        description: 'Output directory for artifacts/history',
        type: 'string',
        default: './.scheml',
      })
      .option('trait', {
        description: 'Single trait name to show',
        type: 'string',
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: any) => {
    const outputDir = path.resolve(argv.output);
    const trait = argv.trait as string | undefined;
    const jsonMode = argv.json as boolean;

    const traits = trait ? [trait] : listTraitsWithHistory(outputDir);
    const data = traits.map((traitName) => ({
      trait: traitName,
      records: readHistoryRecords(outputDir, traitName),
    }));

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: true, traits: data }) + '\n');
      return;
    }

    if (data.length === 0) {
      console.log(chalk.yellow('No history records found.'));
      return;
    }

    for (const item of data) {
      console.log(chalk.cyan(`\n${item.trait}`));
      if (!item.records.length) {
        console.log(chalk.dim('  (no records)'));
        continue;
      }
      for (const record of item.records) {
        console.log(`  ${renderRecordLine(record)}`);
      }
    }
  },
};