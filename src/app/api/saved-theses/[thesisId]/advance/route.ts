import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { evidenceStatus } from '@/thesis/evidence';
import {
  THESIS_STATUSES,
  canAdvance,
  type PathDecision,
  type ThesisStatus,
} from '@/thesis/premortem';
import { NO_STORE, claimStates, loadOwned, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ thesisId: string }> };

/**
 * The only way a thesis changes stage. The check runs here, on the server, so
 * no page, console or script can skip the Failure Table.
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

  let body: { to?: unknown };
  try {
    body = (await request.json()) as { to?: unknown };
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const to = THESIS_STATUSES.find((s) => s === body.to);
  if (!to)
    return Response.json(
      { error: 'Unknown stage.' },
      { status: 400, headers: NO_STORE },
    );

  const from = thesis.status as ThesisStatus;
  const verdict = canAdvance(
    from,
    to,
    thesis.failurePaths.map((p) => ({ decision: p.decision as PathDecision })),
    evidenceStatus(claimStates(thesis.claims), new Date()),
  );
  if (!verdict.ok)
    return Response.json(
      {
        error: verdict.reasons[0],
        code: verdict.code,
        reasons: verdict.reasons,
      },
      { status: 409, headers: NO_STORE },
    );

  // Compare-and-set: two tabs cannot both move the same thesis.
  const moved = await db.thesis.updateMany({
    where: { id: thesis.id, ownerKey: owner.key, status: from },
    data: { status: verdict.to, statusChangedAt: new Date() },
  });
  if (moved.count !== 1)
    return Response.json(
      { error: 'This thesis changed in another tab. Reload it.' },
      { status: 409, headers: NO_STORE },
    );
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json(
      { thesis: fresh ? thesisView(fresh) : null },
      { headers: NO_STORE },
    ),
    owner,
  );
}
