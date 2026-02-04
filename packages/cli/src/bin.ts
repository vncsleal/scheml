#!/usr/bin/env node

/**
 * PrisML CLI entry point
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import * as path from 'path';

// Import commands
import { trainCommand } from './commands/train';

const VERSION = '0.1.0';

async function main() {
  await yargs(hideBin(process.argv))
    .version('version', 'Show version', VERSION)
    .help()
    .command('train', 'Train PrisML models from definitions', trainCommand)
    .demandCommand(1, 'You must provide a command')
    .strict()
    .parse();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
