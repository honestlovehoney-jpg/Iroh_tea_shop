import 'server-only';
import { db } from '@/auth/db';

export async function searchBitgetAssets(input: {
  query: string;
  page?: number;
  pageSize?: number;
}) {
  const query = input.query.trim().slice(0, 120);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 25)));
  const where = query
    ? {
        OR: [
          { companyName: { contains: query } },
          { underlyingTicker: { contains: query } },
          { symbol: { contains: query } },
          { providerInstrumentId: { contains: query } },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    db.bitgetAsset.count({ where }),
    db.bitgetAsset.findMany({
      where,
      orderBy: [{ companyName: 'asc' }, { underlyingTicker: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    query,
    page,
    pageSize,
    total,
    results: rows.map((row) => ({
      provider: 'bitget' as const,
      instrumentId: row.providerInstrumentId,
      symbol: row.symbol,
      underlyingTicker: row.underlyingTicker,
      companyName: row.companyName,
      productType: 'reality_stock',
      listingStatus: row.listingStatus,
      tradingPeriod: safeJson(row.tradingPeriodJson || ''),
      weekendTradable: row.weekendTradable,
      lastVerifiedAt: row.lastVerifiedAt || new Date().toISOString(),
    })),
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
