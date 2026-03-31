/**
 * scheml check command
 * Validates schema-only contract compatibility for trained models.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Argv } from 'yargs';
import chalk from 'chalk';
import {
  ModelMetadata,
} from '..';
import { computeSchemaHashForMetadata } from '../contracts';
import { PrismaSchemaReader } from '../adapters/prisma';

function loadMetadataFiles(outputDir: string, model?: string): string[] {
  if (!fs.existsSync(outputDir)) {
    throw new Error(`Output directory not found: ${outputDir}`);
  }

  const entries = fs.readdirSync(outputDir);
  const metadataFiles = entries.filter((file) => file.endsWith('.metadata.json'));

  if (model) {
    const match = `${model}.metadata.json`;
    if (!metadataFiles.includes(match)) {
      throw new Error(`Metadata not found for model "${model}" in ${outputDir}`);
    }
    return [path.join(outputDir, match)];
  }

  return metadataFiles.map((file) => path.join(outputDir, file));
}

function readMetadata(filePath: string): ModelMetadata {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ModelMetadata;
}

export const checkCommand = {
  command: 'check',
  description: 'Validate schema-only contract compatibility',
  builder: (yargs: Argv) => {
    return yargs
      .option('schema', {
        alias: 's',
        description: 'Path to Prisma schema',
        type: 'string',
        default: './prisma/schema.prisma',
      })
      .option('output', {
        alias: 'o',
        description: 'Output directory for models',
        type: 'string',
        default: './.scheml',
      })
      .option('model', {
        alias: 'm',
        description: 'Single model name to validate',
        type: 'string',
      });
  },
  handler: async (argv: any) => {
    const schemaPath = path.resolve(argv.schema);
    const outputDir = path.resolve(argv.output);
    const modelFilter = argv.model as string | undefined;

    const reader = new PrismaSchemaReader();
    const graph = await reader.readSchema(schemaPath);
    const metadataPaths = loadMetadataFiles(outputDir, modelFilter);

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const metadataPath of metadataPaths) {
      const metadata = readMetadata(metadataPath);
      const deps = metadata.featureDependencies || [];

      if (!deps.length) {
        warnings.push(
          `${metadata.modelName}: No featureDependencies found in metadata (schema-only check skipped).`
        );
        continue;
      }

      const modelNames = new Set(deps.map((dep) => dep.modelName));
      for (const modelName of modelNames) {
        const entity = graph.entities.get(modelName);

        deps
          .filter((dep) => dep.modelName === modelName)
          .forEach((dep) => {
            if (!dep.extractable) {
              warnings.push(
                `${metadata.modelName}: ${dep.path} is dynamic and cannot be statically validated.`
              );
              return;
            }

            const fieldName = dep.path.split('.').slice(1).join('.') || dep.path;
            const schemaField = entity?.fields[fieldName];

            if (!schemaField) {
              errors.push(
                `${metadata.modelName}: Missing field ${dep.path} in Prisma schema.`
              );
              return;
            }

            const expectedType = dep.scalarType;
            const actualType = schemaField.scalarType;
            if (expectedType !== 'unknown' && actualType !== expectedType) {
              errors.push(
                `${metadata.modelName}: ${dep.path} type mismatch (${actualType} != ${expectedType}).`
              );
            }

            if (dep.nullable !== schemaField.nullable) {
              errors.push(
                `${metadata.modelName}: ${dep.path} nullability mismatch (schema nullable=${schemaField.nullable}).`
              );
            }
          });
      }

      const expectedSchemaHash = computeSchemaHashForMetadata(graph.rawSource, metadata);
      if (metadata.prismaSchemaHash !== expectedSchemaHash) {
        warnings.push(
          `${metadata.modelName}: Prisma schema hash differs from metadata (hash mismatch).`
        );
      }
    }

    if (warnings.length) {
      console.log(chalk.yellow('\nWarnings:'));
      warnings.forEach((warning) => console.log(chalk.yellow(`  - ${warning}`)));
    }

    if (errors.length) {
      console.log(chalk.red('\nErrors:'));
      errors.forEach((error) => console.log(chalk.red(`  - ${error}`)));
      throw new Error('Schema-only contract check failed.');
    }

    console.log(chalk.green('\n[OK] Schema-only contract check passed.'));
  },
};
