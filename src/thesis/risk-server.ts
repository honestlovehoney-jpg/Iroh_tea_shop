import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { usMarketOpen } from './evidence';
import { dailyCandles100 } from './price';
import {
  computeRisk,
  type Close,
  type Holding,
  type Portfolio,
  type PositionInput,
  type RiskReport,
} from './risk';

const MAX_MEASURED_HOLDINGS = 8;

export async function loadPortfolio(
  db: PrismaClient,
  ownerKey: string,
): Promise<Portfolio | null> {
  const row = await db.portfolio.findUnique({ where: { ownerKey } });
  if (!row) return null;
  let holdings: Holding[] = [];
  try {
    const parsed: unknown = JSON.parse(row.holdingsJson);
    if (Array.isArray(parsed))
      holdings = parsed.filter(
        (h): h is Holding =>
          typeof h?.symbol === 'string' && typeof h?.valueUsd === 'number',
      );
  } catch {
    holdings = [];
  }
  return {
    totalUsd: row.totalUsd,
    collateralUsd: row.collateralUsd,
    marginUsedUsd: row.marginUsedUsd,
    holdings,
  };
}

/**
 * Measure the risk of adding a position. Prices come from Bitget daily
 * candles. A holding Bitget does not list is reported as not measured, never
 * guessed at.
 */
export async function assessRisk(
  db: PrismaClient,
  input: {
    instrumentId: string | null;
    symbol: string;
    portfolio: Portfolio;
    position: PositionInput;
  },
  now = new Date(),
): Promise<RiskReport & { measuredAt: string }> {
  const closes: Close[] | null = input.instrumentId
    ? await dailyCandles100(input.instrumentId)
    : null;

  const holdingCloses = new Map<string, Close[] | null>();
  const others = [...input.portfolio.holdings]
    .filter((h) => h.symbol !== input.symbol.toUpperCase())
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, MAX_MEASURED_HOLDINGS);
  for (const holding of others) {
    const asset = await db.bitgetAsset.findFirst({
      where: { underlyingTicker: holding.symbol },
      select: { providerInstrumentId: true },
    });
    holdingCloses.set(
      holding.symbol,
      asset ? await dailyCandles100(asset.providerInstrumentId) : null,
    );
  }

  const report = computeRisk({
    portfolio: input.portfolio,
    position: input.position,
    symbol: input.symbol,
    closes,
    holdingCloses,
    marketClosed: !usMarketOpen(now),
  });
  return { ...report, measuredAt: now.toISOString() };
}
