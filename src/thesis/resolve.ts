import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { dailyCandles100 } from './price';
import { brier, outcomeFor, resolvingClose, type Direction } from './seal';

const MAX_PER_CALL = 10;
/** Bitget returns at most 100 daily candles, so a day older than this can no longer be looked up. */
const LOOKBACK_DAYS = 95;
const DAY_MS = 86_400_000;

/**
 * Judge every open seal of this owner whose resolving day has ended. Runs when
 * the owner opens their theses, so no background job is needed. A seal is
 * judged once and never changes after.
 */
export async function resolveDueSeals(
  db: PrismaClient,
  ownerKey: string,
  now = new Date(),
): Promise<number> {
  const theses = await db.thesis.findMany({
    where: { ownerKey },
    include: { seal: true },
  });
  const due = theses
    .flatMap((t) => (t.seal ? [t.seal] : []))
    .filter(
      (s) => s.status === 'open' && s.resolvesAt.getTime() <= now.getTime(),
    )
    .slice(0, MAX_PER_CALL);
  if (due.length === 0) return 0;

  const candles = new Map<
    string,
    Awaited<ReturnType<typeof dailyCandles100>>
  >();
  for (const id of new Set(due.map((s) => s.instrumentId)))
    candles.set(id, await dailyCandles100(id));

  let resolved = 0;
  for (const seal of due) {
    const closes = candles.get(seal.instrumentId) ?? null;
    const close = closes ? resolvingClose(closes, seal.resolvesAt, now) : null;
    if (!close) {
      // Only give up once the candle can no longer be fetched, never because Bitget was briefly down.
      if (
        closes &&
        now.getTime() - seal.resolvesAt.getTime() > LOOKBACK_DAYS * DAY_MS
      )
        await db.seal.update({
          where: { id: seal.id },
          data: { status: 'unresolvable', resolvedAt: now },
        });
      continue;
    }
    const outcome = outcomeFor(
      seal.direction as Direction,
      seal.referencePrice,
      close.close,
    );
    await db.seal.update({
      where: { id: seal.id },
      data: {
        status: 'resolved',
        outcome,
        resolvedPrice: close.close,
        resolvedAt: now,
        userBrier: brier(seal.userProbability, outcome),
        systemBrier: brier(seal.systemProbability, outcome),
      },
    });
    resolved++;
  }
  return resolved;
}
