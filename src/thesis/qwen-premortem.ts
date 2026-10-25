import 'server-only';
import {
  FAILURE_PATH_MAX,
  parseModelPaths,
  type FailurePathFields,
  type ValidationContext,
} from './premortem';

export class PremortemUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PremortemRequest {
  title: string;
  statement: string;
  symbol: string | null;
  lastClose: { price: number; asOf: string } | null;
  /** How many paths to ask for. */
  wanted: number;
  /** How many the table needs from this call to reach the minimum. Fewer than this triggers one retry. */
  minimum: number;
  ctx: ValidationContext;
  /** Conditions already on the table, so Uncle does not repeat them. */
  existing: string[];
}

const SYSTEM = `You are Uncle, a sceptical risk reviewer running a premortem. The person believes a stock thesis. Assume it failed. Write the concrete ways it failed.

Return ONLY JSON, no prose and no code fences, in this shape:
{"paths":[{"condition":string,"probability":number,"impactPct":number,"deadline":"YYYY-MM-DD","trigger":{"kind":"price_below"|"price_above"|"date"|"manual","level":number|null,"note":string}}]}

Rules for every path:
- condition: one sentence a stranger could check later. It must contain a specific number (a price, a percent, a date or a count) and the date by which it happens. No vague wording like "the market turns" or "sentiment weakens".
- probability: your honest chance, strictly between 0 and 1, that this happens before the deadline.
- impactPct: estimated loss as a percent of the person's portfolio if it happens, above 0 and at most 100.
- deadline: a calendar date after today.
- trigger: what to watch. Use price_below or price_above with a numeric level only when a last price is given; otherwise use date or manual.
- Paths must be different failure modes, not rewordings. Use only facts you were given. Never invent figures about the company; thresholds should be derived from the given price or from round numbers.`;

function userPrompt(req: PremortemRequest) {
  const today = req.ctx.now.toISOString().slice(0, 10);
  const price = req.lastClose
    ? `Last observed price: ${req.lastClose.price} (Bitget, ${req.lastClose.asOf}).`
    : 'No price is available, so do not use price triggers.';
  const avoid = req.existing.length
    ? `\nAlready on the table, do not repeat:\n${req.existing.map((c) => `- ${c}`).join('\n')}`
    : '';
  return `Today is ${today}.
Thesis title: ${req.title}
Thesis: ${req.statement}
Stock: ${req.symbol ?? 'not chosen'}
${price}${avoid}

Write exactly ${req.wanted} failure paths.`;
}

export async function askQwen(system: string, user: string): Promise<string> {
  const base = process.env.QWEN_BASE_URL;
  const key = process.env.QWEN_API_KEY;
  if (!base || !key)
    throw new PremortemUnavailableError(
      'Uncle is not configured on the server (QWEN_BASE_URL / QWEN_API_KEY). Write your own failure paths instead.',
      503,
    );
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.QWEN_MODEL || 'qwen3.8-max',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
        max_tokens: 1400,
        enable_thinking: false,
      }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new PremortemUnavailableError(
      'Uncle did not answer in time. Try again, or write your own failure paths.',
      502,
    );
  }
  if (!response.ok)
    throw new PremortemUnavailableError(
      'Uncle could not be reached. Try again, or write your own failure paths.',
      502,
    );
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Ask Uncle for failure paths and keep only the ones that pass validation.
 * Retries once with the reasons the first reply was refused. Throws when it
 * still cannot produce the number asked for: no filler paths are invented.
 */
export async function generateFailurePaths(
  req: PremortemRequest,
): Promise<FailurePathFields[]> {
  const wanted = Math.min(Math.max(req.wanted, 1), FAILURE_PATH_MAX);
  const minimum = Math.min(Math.max(req.minimum, 1), wanted);
  const request = { ...req, wanted };
  let kept: FailurePathFields[] = [];
  let user = userPrompt(request);
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await askQwen(SYSTEM, user);
    const { paths, dropped } = parseModelPaths(reply, req.ctx, wanted);
    kept = [...kept, ...paths].slice(0, wanted);
    if (kept.length >= minimum) return kept;
    const reasons = dropped.flat().slice(0, 4).join(' ');
    user =
      userPrompt({
        ...request,
        wanted: wanted - kept.length,
        existing: [...req.existing, ...kept.map((p) => p.condition)],
      }) + (reasons ? `\nYour last reply was refused for: ${reasons}` : '');
  }
  if (kept.length === 0)
    throw new PremortemUnavailableError(
      'Uncle could not write concrete failure paths for this thesis. Write your own instead.',
      502,
    );
  return kept;
}
