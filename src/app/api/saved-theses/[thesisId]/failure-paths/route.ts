import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import {
  FAILURE_PATH_MAX,
  pathsEditable,
  validateFailurePath,
  type ThesisStatus,
} from '@/thesis/premortem';
import { NO_STORE, loadOwned, pathView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ thesisId: string }> };

/** Add a failure path you wrote yourself. It counts as accepted: you chose it. */
export async function POST(request: Request, { params }: Ctx) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  const { thesisId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  if (!thesis)
    return Response.json({ error: 'Thesis not found.' }, { status: 404, headers: NO_STORE });
  if (!pathsEditable(thesis.status as ThesisStatus))
    return Response.json(
      { error: 'The Failure Table is signed off and cannot change.' },
      { status: 409, headers: NO_STORE },
    );
  if (thesis.failurePaths.length >= FAILURE_PATH_MAX)
    return Response.json(
      { error: `The Failure Table holds at most ${FAILURE_PATH_MAX} paths.` },
      { status: 409, headers: NO_STORE },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const result = validateFailurePath(body, {
    now: new Date(),
    hasInstrument: thesis.instrumentId !== null,
  });
  if (!result.ok)
    return Response.json({ error: result.errors[0], errors: result.errors }, { status: 400, headers: NO_STORE });

  const ordinal = thesis.failurePaths.reduce((m, p) => Math.max(m, p.ordinal), 0) + 1;
  const f = result.value;
  const created = await db.failurePath.create({
    data: {
      thesisId: thesis.id,
      ordinal,
      source: 'user',
      condition: f.condition,
      probability: f.probability,
      impactPct: f.impactPct,
      deadline: new Date(f.deadline),
      triggerKind: f.triggerKind,
      triggerLevel: f.triggerLevel,
      triggerNote: f.triggerNote,
      decision: 'accepted',
      resolvedAt: new Date(),
    },
  });
  return withOwnerCookie(
    Response.json({ path: pathView(created) }, { status: 201, headers: NO_STORE }),
    owner,
  );
}
