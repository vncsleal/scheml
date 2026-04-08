import type { APIRoute } from 'astro';
import { runTemporalDemo } from '../../../lib/demo/runtime';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!Array.isArray(body.scores) || body.scores.length !== 5) {
      throw new Error('scores must be an array of exactly 5 numbers');
    }

    const scores = body.scores.map((value: unknown, index: number) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
        throw new Error(`scores[${index}] must be between 0 and 100`);
      }
      return numericValue;
    });

    const result = await runTemporalDemo({ scores });

    return new Response(JSON.stringify({ ok: true, inputs: { scores }, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Temporal prediction failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
};