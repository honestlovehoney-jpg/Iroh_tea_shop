import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { validatePosition } from '@/thesis/risk';
import { assessRisk, loadPortfolio } from '@/thesis/risk-server';
import { NO_STORE, loadOwned } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ thesisId: string }> };

/** Read the Balance Scale for a position size before deciding to serve the thesis. Changes nothing. */
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
  if (thesis.status !== 'sealed')
    return Response.json(
      {
        error: 'Seal the thesis before reading the Balance Scale.',
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
  const position = validatePosition(body);
  if (!position.ok)
    return Response.json(
      { error: position.errors[0], errors: position.errors },
      { status: 400, headers: NO_STORE },
    );
  const portfolio = await loadPortfolio(db, owner.key);
  if (!portfolio)
    return Response.json(
      {
        error: 'Enter your portfolio first so the risk can be measured.',
        code: 'no_portfolio',
      },
      { status: 409, headers: NO_STORE },
    );
  const report = await assessRisk(db, {
    instrumentId: thesis.instrumentId,
    symbol: thesis.symbol ?? '',
    portfolio,
    position: position.value,
  });
  return withOwnerCookie(
    Response.json({ report }, { headers: NO_STORE }),
    owner,
  );
}
