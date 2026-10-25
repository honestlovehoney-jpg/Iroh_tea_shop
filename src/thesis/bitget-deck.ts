import 'server-only';
import { db } from '@/auth/db';
import { getCandles } from '@/services/bitget/candles';
import { getEquityData } from '@/services/bitget/mcp-client';
import { computeConviction } from './conviction';
import { buildSourceRef } from './source-ref';
import { THESES, findThesis, findTicker } from './deck';
import { MAJORS, marketMetrics, summarizeMarket } from './market';
import {
  CANDLE_WINDOW,
  findQuoteObject,
  numberOrNull,
  sortCandles,
  windowChange,
} from './momentum';
import type {
  CandleEvidence,
  DeckSnapshot,
  MarketBoard,
  MarketRow,
  QuoteEvidence,
  Section,
  Ticker,
  TickerDetail,
  TickerSignal,
} from './types';

const SNAPSHOT_TTL_MS = 60_000;
const QUOTE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;

/** The catalog has no instruments yet, so no ticker can be resolved. */
export class CatalogEmptyError extends Error {
  constructor() {
    super('The Bitget catalog has not been synced yet.');
  }
}

async function resolveInstrument(symbol: string): Promise<string | null> {
  const row = await db.bitgetAsset.findFirst({
    where: { underlyingTicker: symbol },
    select: { providerInstrumentId: true },
  });
  return row?.providerInstrumentId ?? null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function loadSignal(ticker: Ticker): Promise<TickerSignal> {
  const base = {
    symbol: ticker.symbol,
    changePct: null,
    lastClose: null,
    instrumentId: null,
  };
  try {
    const instrumentId = await resolveInstrument(ticker.symbol);
    if (!instrumentId) return { ...base, status: 'empty' };
    const result = await getCandles({
      instrumentId,
      granularity: '1day',
      limit: CANDLE_WINDOW,
    });
    const rows = sortCandles(result.value ?? []);
    const changePct = windowChange(rows.map((row) => row.close));
    if (changePct === null) return { ...base, instrumentId, status: 'empty' };
    return {
      symbol: ticker.symbol,
      status: 'ok',
      changePct,
      lastClose: rows[rows.length - 1].close,
      instrumentId,
      ref: buildSourceRef({
        label: 'Bitget daily candles',
        instrumentId,
        observedAt: rows[rows.length - 1].timestamp,
        windowStart: rows[0].timestamp,
        candles: rows.length,
        fetchedAt: new Date(),
      }),
    };
  } catch {
    return { ...base, status: 'error' };
  }
}

let cached: { at: number; snapshot: DeckSnapshot } | null = null;
let inflight: Promise<DeckSnapshot> | null = null;

async function buildSnapshot(): Promise<DeckSnapshot> {
  if ((await db.bitgetAsset.count()) === 0) throw new CatalogEmptyError();
  const tickers = THESES.flatMap((thesis) => thesis.tickers);
  const unique = [
    ...new Map(tickers.map((ticker) => [ticker.symbol, ticker])).values(),
  ];
  const signals = await mapLimit(unique, CONCURRENCY, loadSignal);
  const bySymbol = new Map(signals.map((signal) => [signal.symbol, signal]));
  const now = Date.now();
  return {
    theses: THESES.map((thesis) => {
      const tickerSignals = thesis.tickers.map(
        (ticker) => bySymbol.get(ticker.symbol) as TickerSignal,
      );
      return {
        id: thesis.id,
        conviction: computeConviction(tickerSignals),
        tickers: tickerSignals,
      };
    }),
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SNAPSHOT_TTL_MS).toISOString(),
    source: 'bitget',
    stale: false,
  };
}

/** One shared snapshot per minute; concurrent callers share one build. */
export async function loadDeckSnapshot(): Promise<DeckSnapshot> {
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.snapshot;
  inflight ??= buildSnapshot()
    .then((snapshot) => {
      cached = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function loadCandles(
  instrumentId: string | null,
): Promise<Section<CandleEvidence>> {
  if (!instrumentId) return { status: 'empty' };
  try {
    const result = await getCandles({
      instrumentId,
      granularity: '1day',
      limit: CANDLE_WINDOW,
    });
    const sorted = sortCandles(result.value ?? []);
    if (!sorted.length) return { status: 'empty' };
    return {
      status: 'ok',
      data: {
        rows: sorted.map((row) => ({
          date: row.timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.baseVolume,
        })),
        changePct: windowChange(sorted.map((row) => row.close)),
        high: Math.max(...sorted.map((row) => row.high)),
        low: Math.min(...sorted.map((row) => row.low)),
      },
    };
  } catch {
    return { status: 'unavailable', reason: 'Bitget did not return candles.' };
  }
}

async function loadQuote(symbol: string): Promise<Section<QuoteEvidence>> {
  try {
    const raw = await Promise.race([
      getEquityData('equity_price_quote', { symbol }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), QUOTE_TIMEOUT_MS),
      ),
    ]);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const quote = findQuoteObject(parsed);
    if (!quote) return { status: 'empty' };
    return {
      status: 'ok',
      data: {
        lastPrice: numberOrNull(quote.last_price),
        open: numberOrNull(quote.open),
        high: numberOrNull(quote.high),
        low: numberOrNull(quote.low),
        close: numberOrNull(quote.close),
        volume: numberOrNull(quote.volume),
      },
    };
  } catch {
    return { status: 'unavailable', reason: 'Bitget MCP did not return a quote.' };
  }
}

/** Evidence for one stock in one thesis, or null when the pair is not in the deck. */
export async function loadTickerDetail(
  thesisId: string,
  symbol: string,
): Promise<TickerDetail | null> {
  const thesis = findThesis(thesisId);
  const ticker = findTicker(thesisId, symbol);
  if (!thesis || !ticker) return null;
  const instrumentId = await resolveInstrument(ticker.symbol).catch(() => null);
  const [candles, quote] = await Promise.all([
    loadCandles(instrumentId),
    loadQuote(ticker.symbol),
  ]);
  const fetchedAt = new Date();
  const candleRows = candles.status === 'ok' ? candles.data.rows : [];
  return {
    thesisId: thesis.id,
    symbol: ticker.symbol,
    instrumentId,
    fetchedAt: fetchedAt.toISOString(),
    stale: false,
    candles,
    quote,
    candlesRef: candleRows.length
      ? buildSourceRef({
          label: 'Bitget daily candles',
          instrumentId,
          observedAt: candleRows[candleRows.length - 1].date,
          windowStart: candleRows[0].date,
          candles: candleRows.length,
          fetchedAt,
        })
      : null,
    // The MCP quote carries no timestamp here, so only the fetch time is known.
    quoteRef:
      quote.status === 'ok'
        ? buildSourceRef({
            label: 'Bitget MCP equity quote',
            instrumentId: ticker.symbol,
            observedAt: null,
            fetchedAt,
          })
        : null,
  };
}

async function loadMarketRow(major: {
  symbol: string;
  name: string;
}): Promise<MarketRow> {
  const base: MarketRow = {
    ...major,
    status: 'empty',
    lastClose: null,
    dayChangePct: null,
    weekChangePct: null,
    closes: [],
    instrumentId: null,
  };
  try {
    const instrumentId = await resolveInstrument(major.symbol);
    if (!instrumentId) return base;
    const result = await getCandles({
      instrumentId,
      granularity: '1day',
      limit: CANDLE_WINDOW,
    });
    const closes = sortCandles(result.value ?? []).map((row) => row.close);
    const metrics = marketMetrics(closes);
    if (metrics.dayChangePct === null && metrics.weekChangePct === null)
      return { ...base, instrumentId };
    const sorted = sortCandles(result.value ?? []);
    return {
      ...base,
      ...metrics,
      closes,
      instrumentId,
      status: 'ok',
      ref: buildSourceRef({
        label: 'Bitget daily candles',
        instrumentId,
        observedAt: sorted[sorted.length - 1]?.timestamp ?? null,
        windowStart: sorted[0]?.timestamp ?? null,
        candles: sorted.length,
        fetchedAt: new Date(),
      }),
    };
  } catch {
    return { ...base, status: 'error' };
  }
}

let marketCached: { at: number; board: MarketBoard } | null = null;
let marketInflight: Promise<MarketBoard> | null = null;

async function buildMarketBoard(): Promise<MarketBoard> {
  if ((await db.bitgetAsset.count()) === 0) throw new CatalogEmptyError();
  const rows = await mapLimit(MAJORS, CONCURRENCY, loadMarketRow);
  const now = Date.now();
  return {
    rows,
    summary: summarizeMarket(rows),
    ref: (() => {
      const refs = rows.flatMap((row) => (row.ref ? [row.ref] : []));
      if (refs.length === 0) return null;
      const newest = refs.reduce((a, b) =>
        Date.parse(b.observedAt ?? '') > Date.parse(a.observedAt ?? '') ? b : a,
      );
      return buildSourceRef({
        label: `Bitget daily candles for ${refs.length} listed stocks`,
        instrumentId: null,
        observedAt: newest.observedAt,
        windowStart: null,
        candles: null,
        fetchedAt: new Date(now),
      });
    })(),
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SNAPSHOT_TTL_MS).toISOString(),
    source: 'bitget',
    stale: false,
  };
}

/** The Observatorium board: one shared build per minute. */
export async function loadMarketBoard(): Promise<MarketBoard> {
  if (marketCached && Date.now() - marketCached.at < SNAPSHOT_TTL_MS)
    return marketCached.board;
  marketInflight ??= buildMarketBoard()
    .then((board) => {
      marketCached = { at: Date.now(), board };
      return board;
    })
    .finally(() => {
      marketInflight = null;
    });
  return marketInflight;
}
