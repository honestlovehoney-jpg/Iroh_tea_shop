import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { resolveDueSeals } from '@/thesis/resolve';
import { NO_STORE, loadOwned, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ thesisId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { thesisId } = await params;
  const owner = await resolveOwner(db, request);
  await resolveDueSeals(db, owner.key).catch(() => 0);
  const thesis = await loadOwned(db, owner, thesisId);
  if (!thesis)
    return withOwnerCookie(
      Response.json({ error: 'Thesis not found.' }, { status: 404, headers: NO_STORE }),
      owner,
    );
  return withOwnerCookie(
    Response.json({ thesis: thesisView(thesis) }, { headers: NO_STORE }),
    owner,
  );
}

/** Only an unfinished thesis can be thrown away. Later stages are a record. */
export async function DELETE(request: Request, { params }: Ctx) {
  const refused = crossSiteError(request, { json: false });
  if (refused) return refused;
  const { thesisId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  if (!thesis)
    return Response.json({ error: 'Thesis not found.' }, { status: 404, headers: NO_STORE });
  if (
    thesis.status !== 'draft' &&
    thesis.status !== 'failures_resolved' &&
    thesis.status !== 'evidence_reviewed'
  )
    return Response.json(
      { error: 'A sealed thesis is a record and cannot be deleted.' },
      { status: 409, headers: NO_STORE },
    );
  await db.thesis.delete({ where: { id: thesis.id } });
  return withOwnerCookie(new Response(null, { status: 204 }), owner);
}
