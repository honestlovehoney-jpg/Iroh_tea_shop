import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { evidenceEditable } from '@/thesis/evidence';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { NO_STORE, loadOwned, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ thesisId: string; claimId: string }> };

async function load(request: Request, { params }: Ctx) {
  const { thesisId, claimId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  const claim = thesis?.claims.find((c) => c.id === claimId);
  return { owner, thesis, claim };
}

const reply = async (owner: Awaited<ReturnType<typeof resolveOwner>>, id: string) => {
  const fresh = await loadOwned(db, owner, id);
  return withOwnerCookie(
    Response.json({ thesis: fresh ? thesisView(fresh) : null }, { headers: NO_STORE }),
    owner,
  );
};

/** Acknowledge a model inference: you have seen that it is the app's arithmetic, not a quoted fact. */
export async function PATCH(request: Request, context: Ctx) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  const { owner, thesis, claim } = await load(request, context);
  if (!thesis || !claim)
    return Response.json({ error: 'Claim not found.' }, { status: 404, headers: NO_STORE });
  if (!evidenceEditable(thesis.status))
    return Response.json(
      { error: 'The Evidence Shelf is signed off and cannot change.' },
      { status: 409, headers: NO_STORE },
    );
  let body: { acknowledge?: unknown };
  try {
    body = (await request.json()) as { acknowledge?: unknown };
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  if (body.acknowledge !== true)
    return Response.json({ error: 'Send {"acknowledge":true}.' }, { status: 400, headers: NO_STORE });
  if (claim.state !== 'inferred')
    return Response.json(
      { error: 'Only a model inference needs acknowledging.' },
      { status: 409, headers: NO_STORE },
    );
  await db.claim.update({ where: { id: claim.id }, data: { acknowledged: true } });
  return reply(owner, thesis.id);
}

/** Remove a source you added. System claims are rebuilt with Refresh instead. */
export async function DELETE(request: Request, context: Ctx) {
  const refused = crossSiteError(request, { json: false });
  if (refused) return refused;
  const { owner, thesis, claim } = await load(request, context);
  if (!thesis || !claim)
    return Response.json({ error: 'Claim not found.' }, { status: 404, headers: NO_STORE });
  if (!evidenceEditable(thesis.status))
    return Response.json(
      { error: 'The Evidence Shelf is signed off and cannot change.' },
      { status: 409, headers: NO_STORE },
    );
  if (claim.origin !== 'user')
    return Response.json(
      { error: 'Bitget claims are rebuilt with Refresh, not deleted.' },
      { status: 409, headers: NO_STORE },
    );
  await db.claim.delete({ where: { id: claim.id } });
  return reply(owner, thesis.id);
}
