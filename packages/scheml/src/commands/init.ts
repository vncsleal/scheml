/**
 * scheml init — scaffold a new ScheML project.
 *
 * Writes a `scheml.config.ts` starter file and creates the `.scheml/` directory.
 * Idempotent: skips files that already exist and reports what was skipped.
 *
 * Usage:
 *   scheml init
 *   scheml init --adapter drizzle
 *   scheml init --output ./my-app --json
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Config template
// ---------------------------------------------------------------------------

function configTemplate(adapter: string): string {
  return `import { defineTrait, defineConfig } from '@vncsleal/scheml';

// ---------------------------------------------------------------------------
// Data shape (replace with your actual Prisma/Drizzle/Zod entity type)
// ---------------------------------------------------------------------------

type User = {
  id: string;
  createdAt: Date;
  monthsActive: number;
  monthlySpend: number;
  plan: 'free' | 'pro' | 'enterprise';
  willChurn?: boolean;
};

// ---------------------------------------------------------------------------
// Trait definitions
// ---------------------------------------------------------------------------

/**
 * Example: user churn prediction.
 * Replace this with your own entity and output field.
 */
export const churnRisk = defineTrait<User>({
  name: 'churnRisk',
  type: 'predictive',
  entity: 'User',

  output: {
    field: 'predictedChurn',
    taskType: 'binary_classification',
    resolver: (user) => user.willChurn ?? false,
  },

  features: {
    monthsActive: (user) => user.monthsActive,
    monthlySpend: (user) => user.monthlySpend,
    isPremium: (user) => user.plan === 'pro' || user.plan === 'enterprise',
  },

  qualityGates: [
    {
      metric: 'accuracy',
      threshold: 0.75,
      comparison: 'gte',
      description: 'Accuracy must be ≥ 75%',
    },
  ],
});

// ---------------------------------------------------------------------------
// Project config
// ---------------------------------------------------------------------------

export default defineConfig({
  adapter: '${adapter}',
  traits: [churnRisk],
});
`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const initCommand = {
  command: 'init',
  description: 'Scaffold a new ScheML project with a starter config',
  builder: (yargs: Argv) =>
    yargs
      .option('adapter', {
        description: 'Adapter to use (prisma | drizzle | zod)',
        type: 'string',
        default: 'prisma',
      })
      .option('output', {
        alias: 'o',
        description: 'Directory to initialise in',
        type: 'string',
        default: '.',
      })
      .option('json', {
        description: 'Emit structured JSON',
        type: 'boolean',
        default: false,
      }),

  handler: async (argv: any) => {
    const adapter = argv.adapter as string;
    const outputDir = path.resolve(argv.output as string);
    const jsonMode = argv.json as boolean;

    const created: string[] = [];
    const skipped: string[] = [];

    // Ensure output directory exists
    ensureDir(outputDir);

    // scheml.config.ts
    const configFile = path.join(outputDir, 'scheml.config.ts');
    const configRelative = path.relative(process.cwd(), configFile);
    if (fs.existsSync(configFile)) {
      skipped.push(configRelative);
    } else {
      fs.writeFileSync(configFile, configTemplate(adapter), 'utf-8');
      created.push(configRelative);
    }

    // .scheml/ directory
    const schemlDir = path.join(outputDir, '.scheml');
    const schemlDirRelative = path.relative(process.cwd(), schemlDir);
    if (fs.existsSync(schemlDir)) {
      skipped.push(schemlDirRelative + '/');
    } else {
      ensureDir(schemlDir);
      created.push(schemlDirRelative + '/');
    }

    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, created, skipped }, null, 2));
      return;
    }

    console.log('');
    if (created.length > 0) {
      for (const f of created) {
        console.log(`  ${chalk.green('✓')} Created  ${chalk.bold(f)}`);
      }
    }
    if (skipped.length > 0) {
      for (const f of skipped) {
        console.log(`  ${chalk.yellow('⚠')} Skipped  ${chalk.dim(f)} (already exists)`);
      }
    }

    if (created.length > 0) {
      console.log('');
      console.log(chalk.dim('  Next steps:'));
      console.log(chalk.dim('    1. Edit scheml.config.ts to define your traits'));
      console.log(chalk.dim('    2. Run scheml train to build your first model'));
      console.log(chalk.dim('    3. Run scheml check to validate schema compatibility'));
    }
    console.log('');
  },
};
