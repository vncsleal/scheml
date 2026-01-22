import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { loadDefinitions } from '../loader';
import { PrisMLModel } from '../../core/types';
import { detectTrainingBackend, getInstallInstructions } from '../../compiler/environment';
import { PrismaDataExtractor } from '../../compiler/analyzer/extractor';
import {
  DatabaseConnectionError,
  NoDataError,
  TrainingFailedError,
  PythonNotFoundError
} from '../../core/errors';

interface TrainOptions {
  file: string;
}

export async function trainCommand(options: TrainOptions) {
  console.log(chalk.gray(`Loading definitions from ${options.file}...`));

  try {
    const models = await loadDefinitions(options.file);
    console.log(chalk.green(`✔ Loaded ${models.length} models.`));

    if (models.length === 0) {
      console.warn(chalk.yellow('No models found. Did you export them using `defineModel`?'));
      return;
    }

    // Process each model
    for (const model of models) {
      await trainSingleModel(model);
    }

  } catch (error: any) {
    console.error(chalk.red(`
 Fatal Error: ${error.message}`));
    process.exit(1);
  }
}

async function trainSingleModel(model: PrisMLModel) {
  console.log(chalk.blue(`
🤖 Processing Model: ${chalk.bold(model.name)} (Target: ${model.target})`));

  const extractor = new PrismaDataExtractor();

  try {
    // 1. Test database connection
    console.log(chalk.gray(`   Testing database connection...`));
    const connected = await extractor.testConnection();
    if (!connected) {
      throw new DatabaseConnectionError();
    }
    console.log(chalk.green(`   ✔ Database connected`));

    // 2. Check available data
    const availableCount = await extractor.getAvailableCount(model);
    console.log(chalk.gray(`   Available training samples: ${availableCount}`));

    if (availableCount === 0) {
      throw new NoDataError(model.name, model.target);
    }

    // 3. Extract training data using new extractor
    const startExtract = Date.now();
    const dataset = await extractor.extractTrainingData(model, {
      batchSize: 1000
    });
    const extractTime = Date.now() - startExtract;

    console.log(chalk.green(`   ✔ Extracted ${dataset.labels.length} samples in ${extractTime}ms`));
    console.log(chalk.gray(`   Features: ${dataset.featureNames.join(', ')}`));

    // 4. Prepare Training Data for Python
    console.log(chalk.gray(`   Preparing training data...`));

    // Determine task type (classification vs regression)
    const taskType = dataset.labels.every((l: any) => l === 0 || l === 1)
      ? 'classification'
      : 'regression';

    const trainingData = {
      features: dataset.features,
      labels: dataset.labels,
      metadata: {
        model_name: model.name,
        feature_names: dataset.featureNames,
        task_type: taskType,
        target_field: model.output,
      }
    };

    // Save training data to temp JSON file
    const tempDir = path.join(process.cwd(), '.prisml', 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const dataPath = path.join(tempDir, `${model.name}_data.json`);
    fs.writeFileSync(dataPath, JSON.stringify(trainingData, null, 2));

    // 5. Detect training backend and execute
    const backend = detectTrainingBackend();
    console.log(chalk.gray(`   Training with ${backend} backend (${model.config?.algorithm || 'RandomForest'})...`));

    // Resolve output directory
    const outDir = path.join(process.cwd(), 'prisml', 'generated');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Resolve asset path securely
    // Find package root by resolving package.json
    let pkgRoot;
    try {
      pkgRoot = path.dirname(require.resolve('@vncsleal/prisml/package.json'));
    } catch {
      // Fallback for local development if package is not linked
      pkgRoot = path.resolve(__dirname, '../../..');
    }
    const scriptPath = path.join(pkgRoot, 'assets/python/trainer.py');

    if (backend === 'local' && !fs.existsSync(scriptPath)) {
      throw new Error(`Trainer script not found at ${scriptPath}. Check your installation.`);
    }

    const artifactPath = path.join(outDir, `${model.name}.onnx`);
    const algorithm = model.config?.algorithm || 'RandomForest';
    const minAccuracy = model.config?.minAccuracy || 0.7;
    const testSplit = model.config?.testSplit || 0.2;

    try {
      if (backend === 'docker') {
        // Docker-based training (recommended)
        const tmpDirAbs = path.resolve(process.cwd(), '.prisml', 'tmp');
        const outDirAbs = path.resolve(process.cwd(), 'prisml', 'generated');

        // Normalize paths for cross-platform compatibility
        const dataPathInContainer = `/data/${path.basename(dataPath)}`;
        const outputPathInContainer = `/output/${model.name}.onnx`;

        const dockerCmd = `docker run --rm \
          -v "${tmpDirAbs}:/data" \
          -v "${outDirAbs}:/output" \
          prisml/trainer:latest \
          --input "${dataPathInContainer}" \
          --output "${outputPathInContainer}" \
          --algorithm ${algorithm} \
          --min-accuracy ${minAccuracy} \
          --test-split ${testSplit}`;

        execSync(dockerCmd, {
          stdio: 'inherit',
          cwd: process.cwd()
        });

      } else if (backend === 'local') {
        // Local Python training
        // const scriptPath = path.join(process.cwd(), 'scripts', 'train.py'); // OLD

        const pythonCmd = `python3 "${scriptPath}" \
          --input "${dataPath}" \
          --output "${artifactPath}" \
          --algorithm ${algorithm} \
          --min-accuracy ${minAccuracy} \
          --test-split ${testSplit}`;

        execSync(pythonCmd, {
          stdio: 'inherit',
          cwd: process.cwd()
        });

      } else if (backend === 'js') {
        // Pure JS fallback (not implemented yet)
        const installInstructions = getInstallInstructions('docker');
        throw new PythonNotFoundError('docker', installInstructions);
      }

      console.log(chalk.green(`   ✔ Training Complete!`));

      // Clean up temp data file
      fs.unlinkSync(dataPath);

    } catch (error: any) {
      if (error.message.includes('Training backend not available')) {
        throw error;
      }
      throw new Error(`Training failed: ${error.message}\n\n${getInstallInstructions(backend)}`);
    }

  } catch (err: any) {
    console.error(chalk.red(`    Failed to process model: ${err.message}`));
  } finally {
    await extractor.disconnect();
  }
}