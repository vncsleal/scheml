import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AnomalyArtifactMetadata } from '../../../../packages/scheml/src/index';

const artifactsDir = path.resolve(process.cwd(), 'demo-artifacts');

let cachedMeta: AnomalyArtifactMetadata | null = null;

function getMeta(): AnomalyArtifactMetadata {
  if (!cachedMeta) {
    const raw = readFileSync(path.join(artifactsDir, 'serverAnomaly.metadata.json'), 'utf-8');
    cachedMeta = JSON.parse(raw) as AnomalyArtifactMetadata;
  }
  return cachedMeta;
}

export type AnomalyInput = {
  cpuUsage: number;
  memoryPressure: number;
  errorRate: number;
};

export async function predictAnomaly(input: AnomalyInput) {
  const startedAt = Date.now();
  const meta = getMeta();
  const { means, stds } = meta.normalization;

  const values = [input.cpuUsage, input.memoryPressure, input.errorRate];
  const zScored = values.map((v, i) => (v - means[i]) / (stds[i] || 1));
  const norm = Math.sqrt(zScored.reduce((s, z) => s + z * z, 0));

  const { threshold } = meta.normScoreStats!;
  const isAnomaly = norm > threshold;
  const score = parseFloat(Math.min(1, Math.max(0, norm / (threshold * 2))).toFixed(4));

  return {
    isAnomaly,
    score,
    norm: parseFloat(norm.toFixed(4)),
    threshold: parseFloat(threshold.toFixed(4)),
    latencyMs: Date.now() - startedAt,
  };
}
