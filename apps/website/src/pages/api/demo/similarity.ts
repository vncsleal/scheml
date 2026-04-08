import type { APIRoute } from 'astro';
import { runSimilarityDemo } from '../../../lib/demo/runtime';

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
      categoryIndex: parseNumber(body.categoryIndex, 'categoryIndex', 0, 4),
      price: parseNumber(body.price, 'price', 0, 2500),
      batteryHours: parseNumber(body.batteryHours, 'batteryHours', 0, 40),
      weightKg: parseNumber(body.weightKg, 'weightKg', 0, 10),
      limit: parseNumber(body.limit ?? 4, 'limit', 1, 8),
    };
    const result = await runSimilarityDemo(inputs);

    return new Response(JSON.stringify({ ok: true, inputs, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Similarity query failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
};