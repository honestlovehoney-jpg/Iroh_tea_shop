import { db } from '@/auth/db';
import { resolveOwner, withOwnerCookie } from '@/thesis/owner';
import { resolveDueSeals } from '@/thesis/resolve';
import { calibration, type ScoredSeal } from '@/thesis/seal';
import { NO_STORE } from '@/thesis/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Your calibration ledger: every sealed thesis, and the Brier score of your
 * probability next to Uncle's for the ones that have been judged.
 */
export async function GET(request: Request) {
  const owner = await resolveOwner(db, request);
  await resolveDueSeals(db, owner.key).catch(() => 0);
  const theses = await db.thesis.findMany({
    where: { ownerKey: owner.key },
    include: { seal: true },
  });
  const sealed = theses
    .flatMap((t) => (t.seal ? [{ thesis: t, seal: t.seal }] : []))
    .sort((a, b) => b.seal.sealedAt.getTime() - a.seal.sealedAt.getTime());
  const scored: ScoredSeal[] = sealed.flatMap(({ seal }) =>
    seal.status === 'resolved' &&
    seal.outcome !== null &&
    seal.userBrier !== null &&
    seal.systemBrier !== null &&
    seal.resolvedAt
      ? [
          {
            userProbability: seal.userProbability,
            systemProbability: seal.systemProbability,
            outcome: seal.outcome,
            userBrier: seal.userBrier,
            systemBrier: seal.systemBrier,
            resolvedAt: seal.resolvedAt.toISOString(),
          },
        ]
      : [],
  );
  return withOwnerCookie(
    Response.json(
      {
        calibration: calibration(scored),
        entries: sealed.map(({ thesis, seal }) => ({
          thesisId: thesis.id,
          title: thesis.title,
          symbol: thesis.symbol,
          direction: seal.direction,
          horizonDays: seal.horizonDays,
          userProbability: seal.userProbability,
          systemProbability: seal.systemProbability,
          sealedAt: seal.sealedAt.toISOString(),
          resolvesAt: seal.resolvesAt.toISOString(),
          status: seal.status,
          outcome: seal.outcome,
          userBrier: seal.userBrier,
          systemBrier: seal.systemBrier,
        })),
      },
      { headers: NO_STORE },
    ),
    owner,
  );
}
