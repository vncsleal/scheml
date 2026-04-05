import type { APIRoute } from 'astro';
import { predictChurnSequence } from '../../../lib/demoSequentialPrediction';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!Array.isArray(body.scores) || body.scores.length !== 5) {
      throw new Error('scores must be an array of exactly 5 numbers');
    }
    const scores = body.scores.map((v: unknown, i: number) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`scores[${i}] must be between 0 and 100`);
      return n;
    });
    const result = await predictChurnSequence({ scores });
    return new Response(JSON.stringify({ ok: true, result, inputs: { scores } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Sequential prediction failed' }),
      { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
};
