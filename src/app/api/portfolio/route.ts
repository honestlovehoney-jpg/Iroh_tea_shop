import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { validatePortfolio } from '@/thesis/risk';
import { loadPortfolio } from '@/thesis/risk-server';
import { NO_STORE } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The portfolio you typed in. Nothing here is read from an exchange or a wallet. */
export async function GET(request: Request) {
  const owner = await resolveOwner(db, request);
  const portfolio = await loadPortfolio(db, owner.key);
  return withOwnerCookie(
    Response.json({ portfolio }, { headers: NO_STORE }),
    owner,
  );
}

export async function PUT(request: Request) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  const owner = await resolveOwner(db, request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const result = validatePortfolio(body);
  if (!result.ok)
    return Response.json(
      { error: result.errors[0], errors: result.errors },
      { status: 400, headers: NO_STORE },
    );
  const p = result.value;
  const data = {
    totalUsd: p.totalUsd,
    collateralUsd: p.collateralUsd,
    marginUsedUsd: p.marginUsedUsd,
    holdingsJson: JSON.stringify(p.holdings),
  };
  await db.portfolio.upsert({
    where: { ownerKey: owner.key },
    create: { ownerKey: owner.key, ...data },
    update: data,
  });
  return withOwnerCookie(
    Response.json({ portfolio: p }, { headers: NO_STORE }),
    owner,
  );
}
