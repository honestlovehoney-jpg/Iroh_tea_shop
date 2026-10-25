import { db } from '@/auth/db';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import {
  evaluateTrigger,
  type PathDecision,
  type TriggerKind,
  type WatchState,
} from '@/thesis/premortem';
import { lastPrice, type LastPrice } from '@/thesis/price';
import { NO_STORE } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_INSTRUMENTS = 10;
const SURFACE: WatchState[] = ['breached', 'approaching', 'expired'];

/**
 * Failure paths you kept, checked against the latest Bitget price and the
 * clock. Returns only the ones that need your attention, worst first.
 */
export async function GET(request: Request) {
  const owner = await resolveOwner(db, request);
  const theses = await db.thesis.findMany({
    where: { ownerKey: owner.key },
    include: {
      failurePaths: {
        where: { decision: { in: ['accepted', 'modified'] as PathDecision[] } },
      },
    },
  });

  const instrumentIds = [
    ...new Set(
      theses
        .filter((t) => t.failurePaths.length > 0 && t.instrumentId)
        .map((t) => t.instrumentId as string),
    ),
  ].slice(0, MAX_INSTRUMENTS);
  const prices = new Map<string, LastPrice | null>();
  await Promise.all(
    instrumentIds.map(async (id) => prices.set(id, await lastPrice(id))),
  );

  const now = new Date();
  const order: Record<WatchState, number> = {
    breached: 0,
    expired: 1,
    approaching: 2,
    clear: 3,
    unmonitored: 4,
  };
  const alerts = theses
    .flatMap((thesis) =>
      thesis.failurePaths.map((path) => {
        const quote = thesis.instrumentId ? (prices.get(thesis.instrumentId) ?? null) : null;
        const result = evaluateTrigger(
          {
            triggerKind: path.triggerKind as TriggerKind,
            triggerLevel: path.triggerLevel,
            deadline: path.deadline.toISOString(),
            triggerNote: path.triggerNote,
          },
          quote?.price ?? null,
          now,
        );
        return {
          thesisId: thesis.id,
          thesisTitle: thesis.title,
          pathId: path.id,
          condition: path.condition,
          state: result.state,
          message: result.message,
          price: quote?.price ?? null,
          priceAsOf: quote?.asOf ?? null,
        };
      }),
    )
    .filter((alert) => SURFACE.includes(alert.state))
    .sort((a, b) => order[a.state] - order[b.state]);

  return withOwnerCookie(
    Response.json({ checkedAt: now.toISOString(), alerts }, { headers: NO_STORE }),
    owner,
  );
}
