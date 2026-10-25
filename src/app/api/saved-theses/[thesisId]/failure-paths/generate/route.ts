import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import {
  FAILURE_PATH_MAX,
  FAILURE_PATH_MIN,
  pathsEditable,
  type ThesisStatus,
} from '@/thesis/premortem';
import { lastPrice } from '@/thesis/price';
import {
  PremortemUnavailableError,
  generateFailurePaths,
} from '@/thesis/qwen-premortem';
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
 * Ask Uncle to fill the Failure Table. Paths you already decided stay. Paths
 * still waiting are replaced. Nothing is stored unless Uncle's paths pass the
 * same checks your own edits face.
 */
export async function POST(request: Request, { params }: Ctx) {
  const refused = crossSiteError(request, { json: false });
  if (refused) return refused;
  const { thesisId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  if (!thesis)
    return Response.json(
      { error: 'Thesis not found.' },
      { status: 404, headers: NO_STORE },
    );
  if (!pathsEditable(thesis.status as ThesisStatus))
    return Response.json(
      { error: 'The Failure Table is signed off and cannot change.' },
      { status: 409, headers: NO_STORE },
    );

  const decided = thesis.failurePaths.filter((p) => p.decision !== 'pending');
  // Aim for four paths on the table, leaving room for one of your own. Past four, fill what is left.
  const TARGET = 4;
  const room = FAILURE_PATH_MAX - decided.length;
  const wanted = decided.length >= TARGET ? room : TARGET - decided.length;
  if (room <= 0)
    return Response.json(
      { error: 'The Failure Table is full. Reject a path to make room.' },
      { status: 409, headers: NO_STORE },
    );
  if (!allowGeneration(owner.key))
    return Response.json(
      {
        error:
          'Uncle needs a rest. Try again in a while, or write your own paths.',
      },
      { status: 429, headers: NO_STORE },
    );

  const now = new Date();
  const price = thesis.instrumentId
    ? await lastPrice(thesis.instrumentId)
    : null;
  let generated;
  try {
    generated = await generateFailurePaths({
      title: thesis.title,
      statement: thesis.content ?? thesis.title,
      symbol: thesis.symbol,
      lastClose: price ? { price: price.price, asOf: price.asOf } : null,
      wanted,
      minimum: Math.max(1, FAILURE_PATH_MIN - decided.length),
      ctx: {
        now,
        hasInstrument: thesis.instrumentId !== null && price !== null,
      },
      existing: decided.map((p) => p.condition),
    });
  } catch (error) {
    if (error instanceof PremortemUnavailableError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE },
      );
    return Response.json(
      { error: 'Uncle could not write failure paths right now.' },
      { status: 502, headers: NO_STORE },
    );
  }

  const base = decided.reduce((m, p) => Math.max(m, p.ordinal), 0);
  await db.$transaction([
    db.failurePath.deleteMany({
      where: { thesisId: thesis.id, decision: 'pending' },
    }),
    ...generated.map((f, index) =>
      db.failurePath.create({
        data: {
          thesisId: thesis.id,
          ordinal: base + index + 1,
          source: 'uncle',
          condition: f.condition,
          probability: f.probability,
          impactPct: f.impactPct,
          deadline: new Date(f.deadline),
          triggerKind: f.triggerKind,
          triggerLevel: f.triggerLevel,
          triggerNote: f.triggerNote,
        },
      }),
    ),
  ]);
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json(
      {
        thesis: fresh ? thesisView(fresh) : null,
        priceAnchored: price !== null,
      },
      { headers: NO_STORE },
    ),
    owner,
  );
}
