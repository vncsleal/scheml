import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SimilarityArtifactMetadata } from '../../../../packages/scheml/src/index';

const PRODUCT_CATALOG: Record<string, { name: string; category: string }> = {
  'prod-01': { name: 'ThinkPad X1 Carbon', category: 'Laptop' },
  'prod-02': { name: 'Dell XPS 13', category: 'Laptop' },
  'prod-03': { name: 'MacBook Air M3', category: 'Laptop' },
  'prod-04': { name: 'Lenovo IdeaPad Slim 5', category: 'Laptop' },
  'prod-05': { name: 'iPad Pro M4', category: 'Tablet' },
  'prod-06': { name: 'Samsung Galaxy Tab S9', category: 'Tablet' },
  'prod-07': { name: 'Microsoft Surface Pro 9', category: 'Tablet' },
  'prod-08': { name: 'Amazon Fire Max 11', category: 'Tablet' },
  'prod-09': { name: 'Sony WH-1000XM5', category: 'Audio' },
  'prod-10': { name: 'Bose QuietComfort 45', category: 'Audio' },
  'prod-11': { name: 'AirPods Pro (2nd gen)', category: 'Audio' },
  'prod-12': { name: 'Jabra Evolve2 85', category: 'Audio' },
  'prod-13': { name: 'Keychron Q3 Pro', category: 'Keyboard' },
  'prod-14': { name: 'HHKB Professional Hybrid', category: 'Keyboard' },
  'prod-15': { name: 'Logitech MX Keys S', category: 'Keyboard' },
  'prod-16': { name: 'Leopold FC660M', category: 'Keyboard' },
  'prod-17': { name: 'Dell UltraSharp U2722D', category: 'Monitor' },
  'prod-18': { name: 'LG 27UK850-W', category: 'Monitor' },
  'prod-19': { name: 'BenQ PD2705Q', category: 'Monitor' },
  'prod-20': { name: 'ASUS ProArt PA278QV', category: 'Monitor' },
};

const artifactsDir = path.resolve(process.cwd(), 'demo-artifacts');

let cachedMeta: SimilarityArtifactMetadata | null = null;
let cachedEmbeddings: Float32Array | null = null;

function loadArtifacts(): { meta: SimilarityArtifactMetadata; embeddings: Float32Array } {
  if (cachedMeta && cachedEmbeddings) return { meta: cachedMeta, embeddings: cachedEmbeddings };
  const raw = readFileSync(path.join(artifactsDir, 'productSimilarity.metadata.json'), 'utf-8');
  cachedMeta = JSON.parse(raw) as SimilarityArtifactMetadata;
  const npyBuf = readFileSync(path.join(artifactsDir, cachedMeta.indexFile));
  cachedEmbeddings = parseNpy(npyBuf);
  return { meta: cachedMeta, embeddings: cachedEmbeddings };
}

function parseNpy(buf: Buffer): Float32Array {
  // NumPy v1 format: 6-byte magic + 1 major + 1 minor + 2-byte header_len (LE) + header + data
  const headerLen = buf.readUInt16LE(8);
  const dataOffset = 10 + headerLen;
  const slice = buf.buffer.slice(buf.byteOffset + dataOffset);
  return new Float32Array(slice);
}

function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export type SimilarityInput = {
  categoryInt: number;
  price: number;
  batteryLife: number;
  weightKg: number;
  k: number;
};

export async function findSimilar(input: SimilarityInput) {
  const startedAt = Date.now();
  const { meta, embeddings } = loadArtifacts();
  const { means, stds } = meta.normalization;

  const values = [input.categoryInt, input.price, input.batteryLife, input.weightKg];
  const zScored = values.map((v, i) => (v - means[i]) / (stds[i] || 1));
  const queryVec = l2Normalize(zScored);

  const { entityCount, embeddingDim, entityIds } = meta;
  const scores: Array<{ id: string; name: string; category: string; score: number }> = [];

  for (let i = 0; i < entityCount; i++) {
    const base = i * embeddingDim;
    let dot = 0;
    for (let j = 0; j < embeddingDim; j++) {
      dot += queryVec[j] * embeddings[base + j];
    }
    const id = entityIds[i];
    const info = PRODUCT_CATALOG[id] ?? { name: id, category: 'Unknown' };
    scores.push({ id, name: info.name, category: info.category, score: dot });
  }

  scores.sort((a, b) => b.score - a.score);

  return {
    results: scores.slice(0, input.k).map((r) => ({ ...r, score: parseFloat(r.score.toFixed(4)) })),
    latencyMs: Date.now() - startedAt,
  };
}
