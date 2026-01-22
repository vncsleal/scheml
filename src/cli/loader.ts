import path from 'path';
import { register } from 'ts-node';
import { PrisMLModel } from '../core/types';

/**
 * Dynamically loads a Typescript file containing PrisML definitions.
 */
export async function loadDefinitions(filePath: string): Promise<PrisMLModel[]> {
  const absolutePath = path.resolve(process.cwd(), filePath);

  // Register ts-node to handle the compilation on the fly
  register({
    transpileOnly: true,
    compilerOptions: { module: 'commonjs' }
  });

  try {
    const module = require(absolutePath);

    const models: PrisMLModel[] = [];

    // Inspect exports to find models
    Object.keys(module).forEach(key => {
      const exportItem = module[key];
      // Heuristic: Check if it looks like a PrisML model
      if (exportItem && exportItem.target && exportItem.features) {
        // Hydrate the name from the export key
        exportItem.name = key;
        models.push(exportItem);
      }
    });

    return models;
  } catch (error) {
    throw new Error(`Failed to load definitions from ${absolutePath}: ${error}`);
  }
}
