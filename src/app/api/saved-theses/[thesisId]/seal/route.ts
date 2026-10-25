import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { dailyCandles100 } from '@/thesis/price';
import { generateSystemProbability } from '@/thesis/qwen-seal';
import { PremortemUnavailableError } from '@/thesis/qwen-premortem';
import {
  baseRate,
  resolvesAtFor,
  validateSealInput,
  MAX_PROBABILITY,
  MIN_PROBABILITY,
} from '@/thesis/seal';
import {
  NO_STORE,
  allowGeneration,
  loadOwned,
  thesisView,
} from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ thesisId: string }> };

/**
 * Seal a thesis: your direction, probability and horizon, next to Uncle's own
 * probability for the same statement, fixed at one moment. Uncle forecasts
 * without seeing your number. After this the seal never changes; it is only
 * scored once, on the Bitget daily close of the resolving day.
 */
export async function POST(request: Request, { params }: Ctx) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  const { thesisId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  if (!thesis)
    return Response.json(
      { error: 'Thesis not found.' },
      { status: 404, headers: NO_STORE },
    );

  if (thesis.status === 'sealed' || thesis.seal)
    return Response.json(
      { error: 'This thesis is already sealed. A seal never changes.' },
      { status: 409, headers: NO_STORE },
    );
  if (thesis.status !== 'evidence_reviewed')
    return Response.json(
      {
        error:
          thesis.status === 'draft'
            ? 'Sign off the Failure Table and the Evidence Shelf first.'
            : 'Sign off the Evidence Shelf first.',
        code: 'out_of_order',
      },
      { status: 409, headers: NO_STORE },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const input = validateSealInput(body);
  if (!input.ok)
    return Response.json(
      { error: input.errors[0], errors: input.errors },
      { status: 400, headers: NO_STORE },
    );
  const { direction, probability, horizonDays } = input.value;

  if (!thesis.instrumentId)
    return Response.json(
      {
        error:
          'Bitget does not list this stock, so the seal could not be judged later. Start a thesis on a listed stock to seal it.',
      },
      { status: 409, headers: NO_STORE },
    );
  const closes = await dailyCandles100(thesis.instrumentId);
  const latest = closes?.[closes.length - 1];
  if (!closes || !latest)
    return Response.json(
      {
        error:
          'Bitget returned no price right now, so the seal has no reference. Try again.',
      },
      { status: 503, headers: NO_STORE },
    );
  const referencePrice = latest.close;
  const rate = baseRate(closes, horizonDays, direction);

  if (!allowGeneration(owner.key))
    return Response.json(
      { error: 'Uncle needs a rest. Try again in a while.' },
      { status: 429, headers: NO_STORE },
    );

  // Uncle forecasts first and never sees the person's number.
  let system: {
    probability: number;
    method: 'uncle' | 'base_rate';
    rationale: string | null;
  } | null = null;
  try {
    const made = await generateSystemProbability({
      title: thesis.title,
      statement: thesis.content ?? thesis.title,
      symbol: thesis.symbol,
      direction,
      horizonDays,
      referencePrice,
      baseRate: rate,
      evidence: thesis.claims
        .filter((c) => c.state !== 'insufficient' && c.valueText)
        .map(
          (c) =>
            `${c.label}: ${c.valueText} (${c.state === 'observed' ? 'observed' : 'computed'}, ${c.sourceLabel})`,
        ),
      failures: thesis.failurePaths
        .filter((p) => p.decision === 'accepted' || p.decision === 'modified')
        .map(
          (p) => `${p.condition} (chance ${Math.round(p.probability * 100)}%)`,
        ),
    });
    if (made)
      system = {
        probability: made.probability,
        method: 'uncle',
        rationale: made.rationale,
      };
  } catch (error) {
    if (!(error instanceof PremortemUnavailableError)) throw error;
  }
  if (!system && rate !== null)
    system = {
      probability: Math.min(0.95, Math.max(0.05, rate)),
      method: 'base_rate',
      rationale:
        'Uncle was unavailable, so this is the share of past windows of this length that moved this way.',
    };
  if (!system)
    return Response.json(
      {
        error:
          'Uncle could not produce a probability right now, and there is not enough history for a base rate. Try again.',
      },
      { status: 503, headers: NO_STORE },
    );
  const systemProbability = Math.min(
    MAX_PROBABILITY,
    Math.max(MIN_PROBABILITY, system.probability),
  );

  // Move the stage first, so two tabs cannot both seal.
  const sealedAt = new Date();
  const moved = await db.thesis.updateMany({
    where: { id: thesis.id, ownerKey: owner.key, status: 'evidence_reviewed' },
    data: { status: 'sealed', statusChangedAt: sealedAt },
  });
  if (moved.count !== 1)
    return Response.json(
      { error: 'This thesis changed in another tab. Reload it.' },
      { status: 409, headers: NO_STORE },
    );
  try {
    await db.seal.create({
      data: {
        thesisId: thesis.id,
        direction,
        horizonDays,
        userProbability: probability,
        systemProbability,
        systemMethod: system.method,
        systemRationale: system.rationale,
        baseRate: rate,
        instrumentId: thesis.instrumentId,
        referencePrice,
        sealedAt,
        resolvesAt: resolvesAtFor(sealedAt, horizonDays),
      },
    });
  } catch {
    await db.thesis.updateMany({
      where: { id: thesis.id, status: 'sealed' },
      data: { status: 'evidence_reviewed' },
    });
    return Response.json(
      { error: 'The seal could not be saved. Nothing was sealed. Try again.' },
      { status: 500, headers: NO_STORE },
    );
  }
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json(
      { thesis: fresh ? thesisView(fresh) : null },
      { status: 201, headers: NO_STORE },
    ),
    owner,
  );
}
