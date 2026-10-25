import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { decideLock, validatePosition, type MetricKey } from '@/thesis/risk';
import { assessRisk, loadPortfolio } from '@/thesis/risk-server';
import { NO_STORE, loadOwned, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ thesisId: string }> };
const KEYS: MetricKey[] = ['concentration', 'correlation', 'gap', 'margin'];

/**
 * Serve the thesis: the last gate. The Balance Scale is measured again here,
 * so a stale preview cannot be used. Each warned metric must be acknowledged
 * by name, and a hard limit also needs a written reason, which is kept with
 * the lock. After this the thesis never changes.
 */
export async function POST(request: Request, { params }: Ctx) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  const { thesisId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  if (!thesis)
    return Response.json({ error: 'Thesis not found.' }, { status: 404, headers: NO_STORE });
  if (thesis.status === 'locked' || thesis.lock)
    return Response.json(
      { error: 'This thesis is already served. It never changes.' },
      { status: 409, headers: NO_STORE },
    );
  if (thesis.status !== 'sealed' || !thesis.seal)
    return Response.json(
      { error: 'Seal the thesis before serving it.', code: 'out_of_order' },
      { status: 409, headers: NO_STORE },
    );

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const position = validatePosition(body);
  if (!position.ok)
    return Response.json(
      { error: position.errors[0], errors: position.errors },
      { status: 400, headers: NO_STORE },
    );
  const portfolio = await loadPortfolio(db, owner.key);
  if (!portfolio)
    return Response.json(
      { error: 'Enter your portfolio first so the risk can be measured.', code: 'no_portfolio' },
      { status: 409, headers: NO_STORE },
    );

  const report = await assessRisk(db, {
    instrumentId: thesis.instrumentId,
    symbol: thesis.symbol ?? '',
    portfolio,
    position: position.value,
  });
  const acknowledged = Array.isArray(body.acknowledged)
    ? body.acknowledged.filter((k): k is MetricKey => KEYS.includes(k as MetricKey))
    : [];
  const decision = decideLock(report, {
    acknowledged,
    overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason : '',
  });
  if (!decision.ok)
    return Response.json(
      { error: decision.errors[0], errors: decision.errors, report },
      { status: 409, headers: NO_STORE },
    );

  const lockedAt = new Date();
  const moved = await db.thesis.updateMany({
    where: { id: thesis.id, ownerKey: owner.key, status: 'sealed' },
    data: { status: 'locked', statusChangedAt: lockedAt },
  });
  if (moved.count !== 1)
    return Response.json(
      { error: 'This thesis changed in another tab. Reload it.' },
      { status: 409, headers: NO_STORE },
    );
  try {
    await db.lock.create({
      data: {
        thesisId: thesis.id,
        plannedUsd: position.value.plannedUsd,
        leverage: position.value.leverage,
        verdict: decision.verdict,
        metricsJson: JSON.stringify(report.metrics),
        acknowledgedKeys: JSON.stringify(acknowledged),
        overrideReason: decision.overrideReason,
        lockedAt,
      },
    });
  } catch {
    await db.thesis.updateMany({
      where: { id: thesis.id, status: 'locked' },
      data: { status: 'sealed' },
    });
    return Response.json(
      { error: 'The lock could not be saved. Nothing was served. Try again.' },
      { status: 500, headers: NO_STORE },
    );
  }
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json({ thesis: fresh ? thesisView(fresh) : null }, { status: 201, headers: NO_STORE }),
    owner,
  );
}
