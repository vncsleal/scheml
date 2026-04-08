import type { APIRoute } from 'astro';
import { runAnomalyDemo } from '../../../lib/demo/runtime';

export const prerender = false;

function parseNumber(value: unknown, field: string, min: number, max: number) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${field} must be a valid number`);
  }
  if (numericValue < min || numericValue > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return numericValue;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const inputs = {
      cpuUsage: parseNumber(body.cpuUsage, 'cpuUsage', 0, 100),
      memoryPressure: parseNumber(body.memoryPressure, 'memoryPressure', 0, 100),
      errorRate: parseNumber(body.errorRate, 'errorRate', 0, 10),
    };
    const result = await runAnomalyDemo(inputs);

    return new Response(JSON.stringify({ ok: true, inputs, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Anomaly prediction failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
};