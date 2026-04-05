import type { APIRoute } from 'astro';
import { findSimilar } from '../../../lib/demoSimilarityPrediction';

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
      categoryInt:  parseNum(body.categoryInt,  'categoryInt',  0,    4),
      price:        parseNum(body.price,        'price',        0, 2500),
      batteryLife:  parseNum(body.batteryLife,  'batteryLife',  0,   50),
      weightKg:     parseNum(body.weightKg,     'weightKg',     0,   10),
      k:            parseNum(body.k ?? 5,       'k',            1,    8),
    };
    const result = await findSimilar(inputs);
    return new Response(JSON.stringify({ ok: true, result, inputs }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Similarity search failed' }),
      { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
};
