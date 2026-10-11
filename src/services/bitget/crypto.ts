import 'server-only';
import { fetchSpotCandles, fetchSpotSymbols, fetchSpotTicker } from './client';
import { normalizeCandleRows } from './candle-normalizer';

const SYMBOLS_TTL_MS = 60 * 60 * 1000;
let cachedBases: { at: number; bases: Set<string> } | null = null;

/** Base coins with a live USDT spot pair on Bitget. Empty when Bitget cannot be reached. */
export async function loadSpotBases(): Promise<Set<string>> {
  if (cachedBases && Date.now() - cachedBases.at < SYMBOLS_TTL_MS) return cachedBases.bases;
  try {
    const rows = await fetchSpotSymbols();
    const bases = new Set<string>();
    for (const row of rows) {
      if (row.quoteCoin !== 'USDT') continue;
      if (typeof row.status === 'string' && row.status !== 'online') continue;
      if (typeof row.baseCoin === 'string' && row.baseCoin) bases.add(row.baseCoin.toUpperCase());
    }
    cachedBases = { at: Date.now(), bases };
    return bases;
  } catch {
    return cachedBases?.bases ?? new Set<string>();
  }
}

function num(value: unknown): number | null {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** About seven days of movement from daily closes, for any Bitget spot pair, stock tokens included. */
export async function weeklyChange(spotSymbol: string) {
  try {
    const { rows } = await fetchSpotCandles({ symbol: spotSymbol, granularity: '1day', limit: 8 });
    const candles = normalizeCandleRows(rows).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (candles.length < 2) return null;
    const first = candles[0];
    const last = candles[candles.length - 1];
    return {
      from: first.timestamp,
      to: last.timestamp,
      firstClose: first.close,
      lastClose: last.close,
      changePct: ((last.close / first.close) - 1) * 100,
      days: candles.length - 1,
    };
  } catch {
    return null;
  }
}

export async function getCryptoEvidence(base: string) {
  const symbol = `${base}USDT`;
  try {
    const [ticker, week] = await Promise.all([fetchSpotTicker(symbol), weeklyChange(symbol)]);
    if (!ticker) return { kind: 'crypto', asset: base, symbol, data: null, week, error: 'No ticker returned for this pair.' };
    const last = num(ticker.lastPr);
    const open = num(ticker.open);
    return {
      kind: 'crypto',
      asset: base,
      symbol,
      data: ticker,
      computed: {
        change24hPct: last !== null && open ? ((last / open) - 1) * 100 : null,
      },
      week,
      error: null as string | null,
    };
  } catch (error) {
    return {
      kind: 'crypto',
      asset: base,
      symbol,
      data: null,
      week: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
