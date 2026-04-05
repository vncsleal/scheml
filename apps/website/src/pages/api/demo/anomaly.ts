import type { APIRoute } from 'astro';
import { predictAnomaly } from '../../../lib/demoAnomalyPrediction';

export const prerender = false;

function parseNum(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a valid number`);
  if (n < min || n > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return n;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const inputs = {
      cpuUsage:       parseNum(body.cpuUsage,       'cpuUsage',       0, 100),
      memoryPressure: parseNum(body.memoryPressure, 'memoryPressure', 0, 100),
      errorRate:      parseNum(body.errorRate,      'errorRate',      0,  10),
    };
    const result = await predictAnomaly(inputs);
    return new Response(JSON.stringify({ ok: true, result, inputs }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Anomaly prediction failed' }),
      { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
};
