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
import { historyCommand } from './commands/history';
import { statusCommand } from './commands/status';
import { materializeCommand } from './commands/materialize';
import { auditCommand } from './commands/audit';
import { migrateCommand } from './commands/migrate';
import { generateCommand } from './commands/generate';

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
    .command('status', 'Show project status for trained traits', statusCommand)
    .command('history', 'Show trait history records', historyCommand)
    .command('materialize', 'Batch inference and write trait predictions to DB column', materializeCommand)
    .command('migrate', 'Generate schema migration for materialized trait columns', migrateCommand)
    .command('generate', 'Write scheml.d.ts extending ORM types with trait properties', generateCommand)
    .command('audit', 'Export full trait history as structured JSON', auditCommand)
    .demandCommand(1, 'You must provide a command')
    .strict()
    .parse();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
