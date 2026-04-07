import type { APIRoute } from 'astro';
import Groq from 'groq-sdk';

export const prerender = false;

const VALID_PLAN_TIERS = ['starter', 'growth', 'enterprise'] as const;
const VALID_ACTIONS = ['retain', 'escalate', 'celebrate'] as const;
type Action = (typeof VALID_ACTIONS)[number];

function parseContext(body: unknown): { planTier: string; willChurn: boolean; monthlySpend: number; prompt: string } {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;

  const planTier = String(b.planTier ?? '');
  if (!VALID_PLAN_TIERS.includes(planTier as (typeof VALID_PLAN_TIERS)[number])) {
    throw new Error(`planTier must be one of: ${VALID_PLAN_TIERS.join(', ')}`);
  }

  const willChurn = Boolean(b.willChurn);

  const monthlySpend = Number(b.monthlySpend);
  if (!Number.isFinite(monthlySpend) || monthlySpend < 0 || monthlySpend > 10_000) {
    throw new Error('monthlySpend must be a number between 0 and 10000');
  }

  const DEFAULT_PROMPT = 'Return the next retention motion for this account in one concise decision.';
  const prompt =
    typeof b.prompt === 'string' && b.prompt.trim().length > 0
      ? b.prompt.trim().slice(0, 500)
      : DEFAULT_PROMPT;

  return { planTier, willChurn, monthlySpend, prompt };
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'GROQ_API_KEY is not configured' }),
      { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }

  try {
    const body = await request.json();
    const ctx = parseContext(body);

    const client = new Groq({ apiKey });
    const startedAt = Date.now();

    const completion = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a B2B SaaS retention decision engine. ' +
            'Given a user account context, decide the single best next action. ' +
            'Respond ONLY with valid JSON in this exact shape: {"action":"<choice>"} ' +
            'where <choice> is exactly one of: retain, escalate, celebrate. ' +
            'No explanation, no extra keys.',
        },
        {
          role: 'user',
          content:
            `Account context:\n` +
            `  planTier: ${ctx.planTier}\n` +
            `  willChurn: ${ctx.willChurn}\n` +
            `  monthlySpend: $${ctx.monthlySpend}\n\n` +
            ctx.prompt,
        },
      ],
    });

    const latencyMs = Date.now() - startedAt;
    const raw = completion.choices[0]?.message?.content ?? '{}';
    let action: Action;

    try {
      const parsed = JSON.parse(raw) as { action?: unknown };
      if (!VALID_ACTIONS.includes(parsed.action as Action)) {
        throw new Error(`Unexpected action value: ${String(parsed.action)}`);
      }
      action = parsed.action as Action;
    } catch {
      throw new Error(`Could not parse model response: ${raw}`);
    }

    return new Response(
      JSON.stringify({ ok: true, result: { action, latencyMs }, context: ctx }),
      { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Generative inference failed' }),
      { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
};
