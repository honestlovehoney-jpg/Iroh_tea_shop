import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { buildMarketClaims, evidenceEditable } from '@/thesis/evidence';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { dailyCloses, lastPrice } from '@/thesis/price';
import { NO_STORE, loadOwned, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ thesisId: string }> };

/**
 * Rebuild the Bitget claims for this thesis. Each claim carries its source and
 * timestamp. Anything Bitget cannot support comes back withheld, not guessed.
 * Sources you added yourself are kept.
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

  const now = new Date();
  const asset = thesis.instrumentId
    ? await db.bitgetAsset.findUnique({
        where: { providerInstrumentId: thesis.instrumentId },
        select: { weekendTradable: true },
      })
    : null;
  const [price, daily] = thesis.instrumentId
    ? await Promise.all([
        lastPrice(thesis.instrumentId),
        dailyCloses(thesis.instrumentId),
      ])
    : [null, null];

  const claims = buildMarketClaims({
    symbol: thesis.symbol,
    instrumentId: thesis.instrumentId,
    price,
    daily,
    weekendTradable: asset?.weekendTradable ?? null,
    now,
  });

  await db.$transaction([
    db.claim.deleteMany({ where: { thesisId: thesis.id, origin: 'system' } }),
    ...claims.map((c) =>
      db.claim.create({
        data: {
          thesisId: thesis.id,
          key: c.key,
          origin: 'system',
          label: c.label,
          valueText: c.valueText,
          state: c.state,
          sourceKind: c.sourceKind,
          sourceLabel: c.sourceLabel,
          sourceUrl: c.sourceUrl,
          observedAt: c.observedAt ? new Date(c.observedAt) : null,
          fetchedAt: new Date(c.fetchedAt),
          marketClosed: c.marketClosed,
          note: c.note,
        },
      }),
    ),
  ]);
  const fresh = await loadOwned(db, owner, thesis.id);
  return withOwnerCookie(
    Response.json(
      { thesis: fresh ? thesisView(fresh) : null },
      { headers: NO_STORE },
    ),
    owner,
  );
}
