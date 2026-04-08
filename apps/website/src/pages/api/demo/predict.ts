import type { APIRoute } from 'astro';
import { runPredictiveDemo } from '../../../lib/demo/runtime';

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
      daysSinceActive: parseNumber(body.daysSinceActive, 'daysSinceActive', 0, 180),
      monthlySpend: parseNumber(body.monthlySpend, 'monthlySpend', 0, 2500),
      supportTickets: parseNumber(body.supportTickets, 'supportTickets', 0, 20),
    };
    const prediction = await runPredictiveDemo(inputs);

    return new Response(JSON.stringify({ ok: true, inputs, prediction }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Prediction failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
};