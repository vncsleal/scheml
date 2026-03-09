import type { APIRoute } from 'astro';
import { predictDemoChurn } from '../../../lib/demoPrediction';

export const prerender = false;

function parseNumber(value: unknown, fieldName: string, min: number, max: number): number {
  const numericValue = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  if (numericValue < min || numericValue > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }

  return numericValue;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const inputs = {
      daysSinceActive: parseNumber(body.daysSinceActive, 'daysSinceActive', 0, 180),
      monthlySpend: parseNumber(body.monthlySpend, 'monthlySpend', 0, 1000),
      supportTickets: parseNumber(body.supportTickets, 'supportTickets', 0, 20),
    };
    const accountId = typeof body.accountId === 'string' && body.accountId.trim().length > 0
      ? body.accountId.trim()
      : 'demo-user';
    const prediction = await predictDemoChurn(inputs, accountId);

    return new Response(JSON.stringify({ ok: true, prediction: { ...prediction, accountId }, inputs }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Prediction failed',
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      }
    );
  }
};
