import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import {
  applyDecision,
  pathsEditable,
  type DecisionRequest,
  type FailurePathFields,
  type ThesisStatus,
} from '@/thesis/premortem';
import { NO_STORE, fieldsOf, loadOwned, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ thesisId: string; pathId: string }> };

const EDITABLE: (keyof FailurePathFields)[] = [
  'condition',
  'probability',
  'impactPct',
  'deadline',
  'triggerKind',
  'triggerLevel',
  'triggerNote',
];

function parseRequest(body: unknown): DecisionRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;
  if (raw.action === 'accept') return { action: 'accept' };
  if (raw.action === 'reject')
    return {
      action: 'reject',
      reason: typeof raw.reason === 'string' ? raw.reason : '',
    };
  if (raw.action === 'modify') {
    const source =
      typeof raw.edits === 'object' && raw.edits !== null
        ? (raw.edits as Record<string, unknown>)
        : {};
    // Only known fields pass through: nothing else can reach the database.
    const edits: Record<string, unknown> = {};
    for (const key of EDITABLE) if (key in source) edits[key] = source[key];
    return { action: 'modify', edits: edits as Partial<FailurePathFields> };
  }
  return null;
}

/** Accept, Modify or Reject one failure path. You can change your mind until the table is signed off. */
export async function PATCH(request: Request, { params }: Ctx) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  const { thesisId, pathId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  const path = thesis?.failurePaths.find((p) => p.id === pathId);
  if (!thesis || !path)
    return Response.json(
      { error: 'Failure path not found.' },
      { status: 404, headers: NO_STORE },
    );
  if (!pathsEditable(thesis.status as ThesisStatus))
    return Response.json(
      { error: 'The Failure Table is signed off and cannot change.' },
      { status: 409, headers: NO_STORE },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const decision = parseRequest(body);
  if (!decision)
    return Response.json(
      { error: 'Choose accept, modify or reject.' },
      { status: 400, headers: NO_STORE },
    );

  const outcome = applyDecision(fieldsOf(path), decision, {
    now: new Date(),
    hasInstrument: thesis.instrumentId !== null,
  });
  if (!outcome.ok)
    return Response.json(
      { error: outcome.errors[0], errors: outcome.errors },
      { status: 400, headers: NO_STORE },
    );

  const f = outcome.fields;
  await db.failurePath.update({
    where: { id: path.id },
    data: {
      decision: outcome.decision,
      decisionReason: outcome.reason,
      resolvedAt: new Date(),
      ...(f
        ? {
            condition: f.condition,
            probability: f.probability,
            impactPct: f.impactPct,
            deadline: new Date(f.deadline),
            triggerKind: f.triggerKind,
            triggerLevel: f.triggerLevel,
            triggerNote: f.triggerNote,
            // Keep what Uncle first wrote, once.
            originalJson: path.originalJson ?? JSON.stringify(fieldsOf(path)),
          }
        : {}),
    },
  });
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json(
      { thesis: fresh ? thesisView(fresh) : null },
      { headers: NO_STORE },
    ),
    owner,
  );
}

/** Remove a path you wrote yourself. Uncle's paths can only be rejected, with a reason. */
export async function DELETE(request: Request, { params }: Ctx) {
  const refused = crossSiteError(request, { json: false });
  if (refused) return refused;
  const { thesisId, pathId } = await params;
  const owner = await resolveOwner(db, request);
  const thesis = await loadOwned(db, owner, thesisId);
  const path = thesis?.failurePaths.find((p) => p.id === pathId);
  if (!thesis || !path)
    return Response.json(
      { error: 'Failure path not found.' },
      { status: 404, headers: NO_STORE },
    );
  if (!pathsEditable(thesis.status as ThesisStatus))
    return Response.json(
      { error: 'The Failure Table is signed off and cannot change.' },
      { status: 409, headers: NO_STORE },
    );
  if (path.source !== 'user')
    return Response.json(
      {
        error: "Uncle's paths cannot be deleted. Reject the path and say why.",
      },
      { status: 409, headers: NO_STORE },
    );
  await db.failurePath.delete({ where: { id: path.id } });
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json(
      { thesis: fresh ? thesisView(fresh) : null },
      { headers: NO_STORE },
    ),
    owner,
  );
}
