import 'server-only';
import { db } from '@/auth/db';
import { fetchStockCatalog, type RawStockInfo } from './client';
import type { BitgetAsset } from './types';

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeRecord(
  raw: RawStockInfo,
  requestTime: string | null,
  now: Date,
): BitgetAsset | null {
  const symbol = nonEmptyString(raw.symbol);
  const ticker = nonEmptyString(raw.code);
  if (!symbol || !ticker) return null;
  return {
    provider: 'bitget',
    providerInstrumentId: symbol,
    symbol,
    underlyingTicker: ticker,
    companyName: nonEmptyString(raw.name),
    tradingPeriod: raw.tradingPeriod ?? null,
    weekendTradable: nonEmptyString(raw.weekendTradable),
    sourceRequestTime: requestTime,
    firstSeenAt: now.toISOString(),
    lastVerifiedAt: now.toISOString(),
  };
}

/** Full catalog sync. Provider symbols are canonical IDs; nullable company names are preserved. */
export async function syncBitgetCatalog(now = new Date()): Promise<{
  received: number;
  valid: number;
  rejected: number;
  uniqueSymbols: number;
}> {
  const { records, requestTime } = await fetchStockCatalog();
  const bySymbol = new Map<string, BitgetAsset>();
  let rejected = 0;
  for (const raw of records) {
    const asset = normalizeRecord(raw, requestTime, now);
    if (!asset) {
      rejected += 1;
      continue;
    }
    const previous = bySymbol.get(asset.symbol);
    bySymbol.set(
      asset.symbol,
      previous ? { ...asset, firstSeenAt: previous.firstSeenAt } : asset,
    );
  }

  // Sequential upserts avoid SQLite write bursts and make a failed sync resumable.
  for (const asset of bySymbol.values()) {
    await db.bitgetAsset.upsert({
      where: { providerInstrumentId: asset.providerInstrumentId },
      create: {
        providerInstrumentId: asset.providerInstrumentId,
        symbol: asset.symbol,
        underlyingTicker: asset.underlyingTicker,
        companyName: asset.companyName,
        tradingPeriodJson: JSON.stringify(asset.tradingPeriod),
        weekendTradable: asset.weekendTradable,
        sourceRequestTime: asset.sourceRequestTime,
        firstSeenAt: new Date(asset.firstSeenAt),
        lastVerifiedAt: new Date(asset.lastVerifiedAt),
        listingStatus: 'active',
      },
      update: {
        symbol: asset.symbol,
        underlyingTicker: asset.underlyingTicker,
        companyName: asset.companyName,
        tradingPeriodJson: JSON.stringify(asset.tradingPeriod),
        weekendTradable: asset.weekendTradable,
        sourceRequestTime: asset.sourceRequestTime,
        lastVerifiedAt: new Date(asset.lastVerifiedAt),
        listingStatus: 'active',
      },
    });
  }

  // Existing records absent from this successful full dump are retained, not deleted.
  await db.bitgetAsset.updateMany({
    where: { lastVerifiedAt: { lt: now }, listingStatus: 'active' },
    data: { listingStatus: 'not_seen_in_latest_sync' },
  });

  return {
    received: records.length,
    valid: bySymbol.size,
    rejected,
    uniqueSymbols: bySymbol.size,
  };
}
