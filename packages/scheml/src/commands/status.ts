/**
 * scheml status command
 * Summarizes artifact + history state for traits/models.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import { readLatestHistoryRecord } from '../history';

interface StatusItem {
  trait: string;
  kind: string;
  entity?: string;
  artifactCompiledAt?: string;
  artifactSchemaHash?: string;
  historyStatus?: string;
  artifactVersion?: string;
  lastTrainedAt?: string;
  drifted: boolean;
}

function listMetadataFiles(outputDir: string): string[] {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir)
    .filter((file) => file.endsWith('.metadata.json'))
    .map((file) => path.join(outputDir, file))
    .sort();
}

function parseMetadata(pathname: string): any {
  try {
    return JSON.parse(fs.readFileSync(pathname, 'utf-8'));
  } catch {
    return null;
  }
}

function createStatusItem(outputDir: string, metadata: any): StatusItem {
  const traitName = metadata.traitName ?? 'unknown';
  const latest = readLatestHistoryRecord(outputDir, traitName);
  return {
    trait: traitName,
    kind: metadata.traitType,
    entity: metadata.entityName,
    artifactCompiledAt: metadata.compiledAt,
    artifactSchemaHash: metadata.schemaHash,
    historyStatus: latest?.status,
    artifactVersion: latest?.artifactVersion,
    lastTrainedAt: latest?.trainedAt,
    drifted: latest?.status === 'drifted',
  };
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

export const statusCommand = {
  command: 'status',
  description: 'Show project status for trained traits',
  builder: (yargs: Argv) => {
    return yargs
      .option('output', {
        alias: 'o',
        description: 'Output directory for artifacts/history',
        type: 'string',
        default: './.scheml',
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      });
  },
  handler: async (argv: any) => {
    const outputDir = path.resolve(argv.output);
    const jsonMode = argv.json as boolean;

    const items = listMetadataFiles(outputDir)
      .map((filePath) => {
        const m = parseMetadata(filePath);
        return m ? createStatusItem(outputDir, m) : null;
      })
      .filter((item): item is StatusItem => item !== null);

    const summary = {
      total: items.length,
      drifted: items.filter((item) => item.drifted).length,
      trained: items.filter((item) => item.historyStatus === 'trained').length,
    };

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: true, summary, traits: items }) + '\n');
      return;
    }

    if (items.length === 0) {
      console.log(chalk.yellow('No artifacts found. Run `scheml train` first.'));
      return;
    }

    console.log(chalk.cyan('\nScheML Status'));
    console.log(
      `${pad('Trait', 28)} ${pad('Type', 12)} ${pad('Version', 8)} ${pad('Status', 10)} Drift`
    );
    for (const item of items) {
      const drift = item.drifted ? chalk.yellow('yes') : chalk.green('no');
      console.log(
        `${pad(item.trait, 28)} ${pad(item.kind, 12)} ${pad(item.artifactVersion ?? '-', 8)} ${pad(item.historyStatus ?? '-', 10)} ${drift}`
      );
    }

    console.log(
      chalk.dim(
        `\nTotal=${summary.total}  Trained=${summary.trained}  Drifted=${summary.drifted}`
      )
    );
  },
};