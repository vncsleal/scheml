import path from 'node:path';
import { PredictionSession } from '../../../../packages/scheml/src/index';

const artifactsDir = path.resolve(process.cwd(), 'demo-artifacts');
const schemaPath = path.join(artifactsDir, 'schema.source');

let sessionPromise: Promise<PredictionSession> | undefined;

function getSession(): Promise<PredictionSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const session = new PredictionSession();
      await session.loadTrait('engagementSequence', { artifactsDir, schemaPath });
      return session;
    })().catch((err) => {
      sessionPromise = undefined;
      throw err;
    });
  }
  return sessionPromise;
}

export type SequentialInput = {
  scores: number[]; // 5 weekly engagement scores (0–100)
};

export async function predictChurnSequence(input: SequentialInput) {
  const startedAt = Date.now();
  const session = await getSession();

  const { scores } = input;
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const sum = scores.reduce((s, v) => s + v, 0);
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  // The engagementSequence model expects pre-aggregated window features:
  // [engagementScore__mean, engagementScore__sum, engagementScore__min, engagementScore__max]
  const entity = {
    engagementScore__mean: mean,
    engagementScore__sum: sum,
    engagementScore__min: min,
    engagementScore__max: max,
  };

  const result = await session.predict('engagementSequence', entity, {
    engagementScore__mean: (e) => e.engagementScore__mean,
    engagementScore__sum: (e) => e.engagementScore__sum,
    engagementScore__min: (e) => e.engagementScore__min,
    engagementScore__max: (e) => e.engagementScore__max,
  });

  const label = Number(result.prediction);

  // Derive rough confidence from mean engagement score since the ONNX model's
  // probability output is not available as a standard tensor (binary classifier).
  const confidence = label === 1
    ? parseFloat(Math.min(0.99, Math.max(0.51, 1 - mean / 100)).toFixed(2))
    : parseFloat(Math.min(0.99, Math.max(0.51, mean / 100)).toFixed(2));

  return {
    predicted: String(label) as '0' | '1',
    confidence,
    latencyMs: Date.now() - startedAt,
  };
}
