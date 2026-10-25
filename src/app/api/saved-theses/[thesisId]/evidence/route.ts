import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { evidenceEditable, validateUserClaim } from '@/thesis/evidence';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { checkPrimarySource } from '@/thesis/source-fetch';
import { NO_STORE, loadOwned, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_USER_CLAIMS = 10;
type Ctx = { params: Promise<{ thesisId: string }> };

/** Add a source you found yourself: an SEC filing, a company release or a central bank statement. */
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
  if (!evidenceEditable(thesis.status))
    return Response.json(
      {
        error:
          thesis.status === 'draft'
            ? 'Sign off the Failure Table first.'
            : 'The Evidence Shelf is signed off and cannot change.',
      },
      { status: 409, headers: NO_STORE },
    );
  if (
    thesis.claims.filter((c) => c.origin === 'user').length >= MAX_USER_CLAIMS
  )
    return Response.json(
      { error: `You can add up to ${MAX_USER_CLAIMS} sources.` },
      { status: 409, headers: NO_STORE },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const result = validateUserClaim(body, new Date());
  if (!result.ok)
    return Response.json(
      { error: result.errors[0], errors: result.errors },
      { status: 400, headers: NO_STORE },
    );
  const c = { ...result.value };
  let verifiedAt: Date | null = null;
  let excerpt: string | null = null;
  if (result.verify && c.sourceUrl) {
    // Read the page itself. The figure has to be on it, or the claim is refused.
    const check = await checkPrimarySource(
      c.sourceKind,
      c.sourceUrl,
      c.valueText ?? '',
      c.label,
    );
    if (check.status === 'not_found')
      return Response.json(
        {
          error:
            'The page was read, but that figure was not found near those words. Check the number and the link.',
        },
        { status: 422, headers: NO_STORE },
      );
    if (check.status === 'verified') {
      c.state = 'observed';
      c.sourceUrl = check.finalUrl;
      verifiedAt = new Date();
      excerpt = check.verification.excerpt || null;
    } else {
      c.note = `Could not read the page, so the figure is unverified: ${check.reason}`;
    }
  }
  await db.claim.create({
    data: {
      thesisId: thesis.id,
      key: c.key,
      origin: 'user',
      label: c.label,
      valueText: c.valueText,
      state: c.state,
      sourceKind: c.sourceKind,
      sourceLabel: c.sourceLabel,
      sourceUrl: c.sourceUrl,
      observedAt: c.observedAt ? new Date(c.observedAt) : null,
      fetchedAt: new Date(c.fetchedAt),
      marketClosed: false,
      note: c.note,
      verifiedAt,
      excerpt,
    },
  });
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json(
      { thesis: fresh ? thesisView(fresh) : null },
      { status: 201, headers: NO_STORE },
    ),
    owner,
  );
}
