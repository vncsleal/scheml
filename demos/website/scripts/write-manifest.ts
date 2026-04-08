import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  anomalyPresets,
  generativeExamples,
  predictivePresets,
  productCatalog,
  similarityPresets,
  temporalPresets,
} from '../src/demoData';

const bundleDir = path.resolve(import.meta.dirname, '../../../apps/website/demo-bundle');

type TraitSummary = {
  traitName: string;
  traitType: string;
  artifactFormat: string;
  compiledAt: string;
  schemaHash: string;
  artifactFile: string | null;
  metrics?: Array<{ metric: string; value: number; split?: string }>;
  outputSchemaShape?: string;
  choiceOptions?: string[];
};

function readMetadata(fileName: string) {
  return JSON.parse(readFileSync(path.join(bundleDir, fileName), 'utf-8')) as Record<string, unknown>;
}

const metadataFiles = [
  'userChurn.metadata.json',
  'serverAnomaly.metadata.json',
  'productSimilarity.metadata.json',
  'engagementSequence.metadata.json',
  'retentionMessage.metadata.json',
];

const traits = metadataFiles.map((fileName) => {
  const metadata = readMetadata(fileName);
  const summary: TraitSummary = {
    traitName: String(metadata.traitName),
    traitType: String(metadata.traitType),
    artifactFormat: String(metadata.artifactFormat),
    compiledAt: String(metadata.compiledAt),
    schemaHash: String(metadata.schemaHash),
    artifactFile: typeof metadata.onnxFile === 'string'
      ? metadata.onnxFile
      : typeof metadata.indexFile === 'string'
        ? String(metadata.indexFile)
        : null,
  };

  if (Array.isArray(metadata.trainingMetrics)) {
    summary.metrics = metadata.trainingMetrics as TraitSummary['metrics'];
  }

  if (typeof metadata.outputSchemaShape === 'string') {
    summary.outputSchemaShape = metadata.outputSchemaShape;
  }

  if (Array.isArray(metadata.choiceOptions)) {
    summary.choiceOptions = metadata.choiceOptions as string[];
  }

  return summary;
});

const manifest = {
  generatedAt: new Date().toISOString(),
  bundleDir: 'demo-bundle',
  traits,
  ui: {
    products: productCatalog,
    predictivePresets,
    anomalyPresets,
    similarityPresets,
    temporalPresets,
    generativeExamples,
    categories: [
      { value: 0, label: 'Laptop' },
      { value: 1, label: 'Tablet' },
      { value: 2, label: 'Audio' },
      { value: 3, label: 'Keyboard' },
      { value: 4, label: 'Monitor' },
    ],
  },
};

writeFileSync(path.join(bundleDir, 'demo.manifest.json'), JSON.stringify(manifest, null, 2));