#!/usr/bin/env node

/**
 * ScheML CLI entry point
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import * as path from 'path';
import { trainCommand } from './commands/train';
import { checkCommand } from './commands/check';

function resolveCliVersion(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: string;
    };
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = resolveCliVersion();

async function main() {
  await yargs(hideBin(process.argv))
    .version('version', 'Show version', VERSION)
    .help()
    .command('train', 'Train ScheML models from definitions', trainCommand)
    .command('check', 'Validate schema-only contract compatibility', checkCommand)
    .demandCommand(1, 'You must provide a command')
    .strict()
    .parse();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
