import { db } from '@/auth/db';
import { crossSiteError } from '@/auth/same-origin';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { resolveDueSeals } from '@/thesis/resolve';
import { NO_STORE, thesisView } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_THESES_PER_OWNER = 25;
const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

/** Your own theses, newest first. Guests see the ones their browser created. */
export async function GET(request: Request) {
  const owner = await resolveOwner(db, request);
  await resolveDueSeals(db, owner.key).catch(() => 0);
  const theses = await db.thesis.findMany({
    where: { ownerKey: owner.key },
    orderBy: { createdAt: 'desc' },
    include: {
      failurePaths: { orderBy: { ordinal: 'asc' } },
      claims: true,
      seal: true,
      lock: true,
    },
  });
  return withOwnerCookie(
    Response.json({ theses: theses.map(thesisView) }, { headers: NO_STORE }),
    owner,
  );
}

/** Start a thesis as a draft. It cannot move on until its Failure Table is complete. */
export async function POST(request: Request) {
  const refused = crossSiteError(request, { json: true });
  if (refused) return refused;
  const owner = await resolveOwner(db, request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const symbol =
    typeof body.symbol === 'string' && body.symbol.trim()
      ? body.symbol.trim().toUpperCase()
      : null;
  if (title.length < 3 || title.length > 120)
    return Response.json(
      { error: 'Give the thesis a title of 3 to 120 characters.' },
      { status: 400 },
    );
  if (content.length < 20 || content.length > 2000)
    return Response.json(
      { error: 'State the thesis in 20 to 2000 characters.' },
      { status: 400 },
    );
  if (symbol && !SYMBOL.test(symbol))
    return Response.json({ error: 'That is not a stock symbol.' }, { status: 400 });

  const count = await db.thesis.count({ where: { ownerKey: owner.key } });
  if (count >= MAX_THESES_PER_OWNER)
    return Response.json(
      { error: `You can keep ${MAX_THESES_PER_OWNER} theses. Delete one first.` },
      { status: 409 },
    );

  const asset = symbol
    ? await db.bitgetAsset.findFirst({
        where: { underlyingTicker: symbol },
        select: { providerInstrumentId: true },
      })
    : null;

  const created = await db.thesis.create({
    data: {
      title,
      content,
      symbol,
      instrumentId: asset?.providerInstrumentId ?? null,
      ownerKey: owner.key,
      status: 'draft',
      statusChangedAt: new Date(),
    },
    include: { failurePaths: true, claims: true, seal: true, lock: true },
  });
  return withOwnerCookie(
    Response.json(
      {
        thesis: thesisView(created),
        // Tell the page plainly when price triggers will not be available.
        monitoring: asset ? 'price' : 'manual',
      },
      { status: 201, headers: NO_STORE },
    ),
    owner,
  );
}
