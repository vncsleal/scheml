import { execSync } from 'child_process';
import chalk from 'chalk';

export type TrainingBackend = 'docker' | 'local' | 'js';

/**
 * Auto-detect the best available training backend
 * Priority: Docker > Local Python > Pure JS
 */
export function detectTrainingBackend(): TrainingBackend {
  const envOverride = process.env.PRISML_TRAIN_BACKEND as TrainingBackend | undefined;

  if (envOverride) {
    console.log(chalk.gray(`Using environment override: ${envOverride}`));
    return envOverride;
  }

  // Priority 1: Check for Docker
  if (isDockerAvailable()) {
    console.log(chalk.gray('✓ Docker detected - using containerized training'));
    return 'docker';
  }

  // Priority 2: Check for local Python
  if (isPythonAvailable()) {
    console.log(chalk.gray('✓ Python detected - using local training'));
    return 'local';
  }

  // Priority 3: Fallback to Pure JS (limited)
  console.log(chalk.yellow('⚠ No Docker or Python found - falling back to Pure JS (limited functionality)'));
  console.log(chalk.gray('  Install Docker for best experience: https://docs.docker.com/get-docker/'));
  return 'js';
}

/**
 * Check if Docker is available
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    // Also check if Docker daemon is running
    execSync('docker ps', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Python 3 and required packages are available
 */
function isPythonAvailable(): boolean {
  try {
    // Check Python version
    const version = execSync('python3 --version', { encoding: 'utf-8' });
    if (!version.includes('Python 3')) {
      return false;
    }

    // Check if scikit-learn is installed
    execSync('python3 -c "import sklearn; import skl2onnx"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get installation instructions for missing dependencies
 */
export function getInstallInstructions(backend: TrainingBackend): string {
  if (backend === 'docker') {
    return `
Docker not found. Install Docker:
  macOS/Windows: https://docs.docker.com/get-docker/
  Linux: https://docs.docker.com/engine/install/

Then pull the PrisML trainer image:
  docker pull prisml/trainer:latest
`;
  }

  if (backend === 'local') {
    return `
Python 3 or required packages not found.

1. Install Python 3.8+:
   https://www.python.org/downloads/

2. Install dependencies:
   pip install -r scripts/requirements.txt
`;
  }

  return 'Pure JS training is experimental and limited to small datasets (<1000 rows).';
}
