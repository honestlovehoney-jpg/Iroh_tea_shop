import { NextResponse } from 'next/server';
import { lockAnswer } from '@/thesis/answer-lock';
import { usMarketOpen } from '@/thesis/evidence';
import { db } from '@/auth/db';
import { loadThesisContext } from '@/chat/thesis-context';
import {
  UNCLE_VOICE,
  questionBlock,
  sanitizePriorMessages,
} from '@/chat/uncle-voice';
import { loadDeckSnapshot } from '@/thesis/bitget-deck';
import { callMcpTool, getEquityData } from '@/services/bitget/mcp-client';
import { fetchSpotCandles, fetchSpotTicker } from '@/services/bitget/client';
import { normalizeCandleRows } from '@/services/bitget/candle-normalizer';
import { findCryptoMentions, findMentions } from '@/services/bitget/mentions';
import {
  getCryptoEvidence,
  loadSpotBases,
  weeklyChange,
} from '@/services/bitget/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const EXTRA_TIMEOUT_MS = 5_000;
const EXTRA_MAX_CHARS = 700;
const EXTRA_STOCK_LIMIT = 3;
const QUOTE_TIMEOUT_MS = 4_500;
const QUOTE_HEDGE_MS = 1_800;
const HISTORY_DAYS = 90;
const HISTORY_TTL_MS = 10 * 60 * 1000;
const SPOT_TIMEOUT_MS = 8_000;
const CORE_CONCURRENCY = 2;
const EXTRAS_CONCURRENCY = 3;
const EXTRAS_SOFT_MS = 5_000;
const EXTRA_CACHE_TTL_MS = 15 * 60 * 1000;
/** Slow entries get a longer own limit. They never hold up the answer, see EXTRAS_SOFT_MS. */
const ENTRY_TIMEOUT_MS: Record<string, number> = {
  equity_estimates_price_target: 12_000,
};

/**
 * Extra Bitget MCP research entries fetched for each stock, beyond the quote.
 * Override on Railway with BITGET_EXTRA_ENTRIES (comma separated entry ids),
 * for example: equity_estimates_consensus,equity_calendar
 */
const EXTRA_ENTRIES = (
  process.env.BITGET_EXTRA_ENTRIES ||
  'equity_estimates_consensus,equity_estimates_price_target,equity_calendar'
)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

/** Extra query parameters per entry, beyond symbol. Keeps results short. */
const ENTRY_PARAMS: Record<string, Record<string, unknown>> = {
  equity_estimates_price_target: { limit: 3 },
  equity_fundamental_ratios: { limit: 1 },
};

type CatalogRow = {
  underlyingTicker: string | null;
  companyName: string | null;
  symbol: string;
};
let catalogCache: { at: number; rows: CatalogRow[] } | null = null;

async function loadCatalog(): Promise<CatalogRow[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS)
    return catalogCache.rows;
  const rows = await db.bitgetAsset.findMany({
    select: { underlyingTicker: true, companyName: true, symbol: true },
  });
  catalogCache = { at: Date.now(), rows };
  return rows;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms} ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The Bitget MCP server slows down or times out when many calls arrive at once, so each lane
 * runs a limited number of calls together. Quote calls use their own lane, so slow research
 * entries can never starve them. A call that waits or runs past its limit fails fast and
 * frees its slot.
 */
function makeLimiter(limit: number) {
  let active = 0;
  const waiters: Array<{
    run: () => void;
    cancelled: boolean;
    granted: boolean;
  }> = [];

  function release() {
    while (waiters.length) {
      const waiter = waiters.shift()!;
      if (!waiter.cancelled) {
        waiter.granted = true;
        waiter.run();
        return;
      }
    }
    active--;
  }

  return async function run<T>(fn: () => Promise<T>, ms: number): Promise<T> {
    const started = Date.now();
    if (active < limit) {
      active++;
    } else {
      const waiter = { run: () => {}, cancelled: false, granted: false };
      const gate = new Promise<void>((resolve) => {
        waiter.run = resolve;
      });
      waiters.push(waiter);
      try {
        await withTimeout(gate, ms);
      } catch (error) {
        if (waiter.granted) release();
        else waiter.cancelled = true;
        throw error;
      }
    }
    try {
      return await withTimeout(
        fn(),
        Math.max(1000, ms - (Date.now() - started)),
      );
    } finally {
      release();
    }
  };
}

const mcpCore = makeLimiter(CORE_CONCURRENCY);
const mcpExtras = makeLimiter(EXTRAS_CONCURRENCY);

/**
 * Intermittently a single MCP call hangs while the same call succeeds right after. If the first
 * attempt is not back after hedgeMs, or fails, a second identical attempt starts. First success wins.
 */
function withHedge<T>(call: () => Promise<T>, hedgeMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let launched = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const launch = () => {
      if (settled || launched >= 2) return;
      launched++;
      call().then(
        (value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          failures++;
          if (settled) return;
          if (launched < 2) {
            launch();
            return;
          }
          if (failures >= launched) {
            settled = true;
            if (timer) clearTimeout(timer);
            reject(error);
          }
        },
      );
    };
    launch();
    timer = setTimeout(launch, hedgeMs);
  });
}

const historyCache = new Map<
  string,
  { at: number; closes: Map<string, number> }
>();

/** Daily closes keyed by UTC date, from Bitget spot candles (works for rTokens and coins). */
async function loadCloses(
  spotSymbol: string,
): Promise<Map<string, number> | null> {
  const hit = historyCache.get(spotSymbol);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.closes;
  try {
    const { rows } = await withTimeout(
      fetchSpotCandles({
        symbol: spotSymbol,
        granularity: '1day',
        limit: HISTORY_DAYS,
      }),
      SPOT_TIMEOUT_MS,
    );
    const closes = new Map<string, number>();
    for (const candle of normalizeCandleRows(rows))
      closes.set(candle.timestamp.slice(0, 10), candle.close);
    if (closes.size < 10) return null;
    historyCache.set(spotSymbol, { at: Date.now(), closes });
    return closes;
  } catch {
    return null;
  }
}

function dayBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Percent change over every rolling seven-day window, keyed by the window's end date. */
function rollingWeek(closes: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [date, close] of closes) {
    const prior = closes.get(dayBefore(date, 7));
    if (prior) out.set(date, (close / prior - 1) * 100);
  }
  return out;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const r2 = (value: number | null) =>
  value === null ? null : Math.round(value * 100) / 100;

function assetHistory(weekly: Map<string, number>) {
  const values = [...weekly.values()].sort((a, b) => a - b);
  if (values.length < 8) return null;
  return {
    windows: values.length,
    medianPct: r2(quantile(values, 0.5)),
    p10Pct: r2(quantile(values, 0.1)),
    p90Pct: r2(quantile(values, 0.9)),
    worstPct: r2(values[0]),
  };
}

function pairHistory(a: Map<string, number>, b: Map<string, number>) {
  const spreads: Array<{ end: string; spread: number }> = [];
  for (const [end, pa] of a) {
    const pb = b.get(end);
    if (pb !== undefined) spreads.push({ end, spread: pa - pb });
  }
  if (spreads.length < 8) return null;
  spreads.sort((x, y) => x.end.localeCompare(y.end));
  const values = spreads.map((item) => item.spread);
  const sorted = [...values].sort((x, y) => x - y);
  const independent: number[] = [];
  for (let i = spreads.length - 1; i >= 0; i -= 7)
    independent.push(spreads[i].spread);
  return {
    windows: values.length,
    firstBeatsSecondPct: Math.round(
      (values.filter((v) => v > 0).length / values.length) * 100,
    ),
    medianSpreadPts: r2(quantile(sorted, 0.5)),
    worstSpreadPts: r2(sorted[0]),
    bestSpreadPts: r2(sorted[sorted.length - 1]),
    independentWeeks: independent.length,
    firstBeatsSecondInIndependentWeeks: independent.filter((v) => v > 0).length,
  };
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function num(value: unknown): number | null {
  const parsed =
    typeof value === 'string' || typeof value === 'number'
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Keep only the fields Uncle needs from the underlying US stock quote. */
function slimQuote(raw: unknown) {
  const row = (
    raw as { data?: { results?: Array<Record<string, unknown>> } } | null
  )?.data?.results?.[0];
  if (!row) return null;
  return {
    last_price: num(row.last_price),
    prev_close: num(row.prev_close),
    change_percent: num(row.change_percent),
    pb: num(row.pb),
    total_market_cap: num(row.total_market_cap),
  };
}

/** Compact any MCP entry result so the prompt stays small. */
function slimExtra(raw: unknown): string | null {
  const parsed = parseMaybeJson(raw) as { data?: { results?: unknown } } | null;
  const results = parsed?.data?.results;
  const body = Array.isArray(results)
    ? results.slice(0, 3)
    : (parsed?.data ?? parsed);
  if (body === null || body === undefined) return null;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > EXTRA_MAX_CHARS
    ? `${text.slice(0, EXTRA_MAX_CHARS)}...`
    : text;
}

/** Approximate US cash-session check in New York time. Holidays are not handled. */
function usMarketOpenNow(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

type ExtraResult = { entry: string; data: string | null; error: string | null };
const extraCache = new Map<string, { at: number; data: string }>();

async function fetchExtra(
  entryId: string,
  ticker: string,
): Promise<ExtraResult> {
  const key = `${entryId}:${ticker}`;
  const hit = extraCache.get(key);
  if (hit && Date.now() - hit.at < EXTRA_CACHE_TTL_MS) {
    return { entry: entryId, data: hit.data, error: null };
  }
  try {
    const raw = await mcpExtras(
      () =>
        getEquityData(entryId, {
          symbol: ticker,
          ...(ENTRY_PARAMS[entryId] ?? {}),
        }),
      ENTRY_TIMEOUT_MS[entryId] ?? EXTRA_TIMEOUT_MS,
    );
    const summary = slimExtra(raw);
    if (summary) {
      if (extraCache.size > 400) extraCache.clear();
      extraCache.set(key, { at: Date.now(), data: summary });
    }
    return {
      entry: entryId,
      data: summary,
      error: summary ? null : 'Empty result',
    };
  } catch (err) {
    return {
      entry: entryId,
      data: null,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    };
  }
}

/**
 * Wait for research entries only up to EXTRAS_SOFT_MS. A slow entry keeps running and fills
 * the cache, so the next question about the same stock gets it instantly.
 */
async function softExtras(ticker: string): Promise<ExtraResult[]> {
  const late = new Promise<'late'>((resolve) =>
    setTimeout(() => resolve('late'), EXTRAS_SOFT_MS),
  );
  return Promise.all(
    EXTRA_ENTRIES.map(async (entry) => {
      const result = await Promise.race([fetchExtra(entry, ticker), late]);
      if (result === 'late') {
        return {
          entry,
          data: null,
          error: 'Still loading, cached for the next question',
        };
      }
      return result;
    }),
  );
}

const MOOD_TTL_MS = 5 * 60 * 1000;
let moodCache: {
  at: number;
  data: { usMarketFearGreed: string | null; cryptoFearGreed: string | null };
} | null = null;

/** Market-wide fear and greed readings from free Bitget MCP sentiment entries. */
async function loadMarketMood() {
  if (moodCache && Date.now() - moodCache.at < MOOD_TTL_MS)
    return moodCache.data;
  const read = (entry: string, params: Record<string, unknown>) =>
    mcpExtras(() => getEquityData(entry, params), EXTRA_TIMEOUT_MS).then(
      (raw) => slimExtra(raw),
      () => null,
    );
  const [usMarketFearGreed, cryptoFearGreed] = await Promise.all([
    read('sentiment_market_fear_greed', {}),
    read('crypto_sentiment_crypto_fear_greed', { limit: 1 }),
  ]);
  const data = { usMarketFearGreed, cryptoFearGreed };
  if (usMarketFearGreed || cryptoFearGreed)
    moodCache = { at: Date.now(), data };
  return data;
}

/**
 * Host research: Bitget MCP evidence → Qwen explanation.
 * Secrets stay server-side. Read-only.
 */
export async function POST(request: Request) {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  try {
    const body = (await request.json()) as {
      question?: string;
      symbol?: string;
      instrumentId?: string;
      priorMessages?: unknown;
      thesisId?: unknown;
      discover?: boolean;
      probeLabels?: number[];
    };

    // Protected helper: list what the Bitget MCP guide says about news and sentiment entries.
    if (body.discover) {
      const token = process.env.BITGET_CATALOG_SYNC_TOKEN;
      if (
        !token ||
        request.headers.get('authorization') !== `Bearer ${token}`
      ) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const attempt = async (args: Record<string, unknown>) => {
        try {
          return {
            args,
            result: parseMaybeJson(
              await withTimeout(callMcpTool('guide', args), 10_000),
            ),
          };
        } catch (err) {
          return {
            args,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      };
      const probeLabels = (
        Array.isArray(body.probeLabels) ? body.probeLabels : []
      )
        .map(Number)
        .filter((n) => Number.isInteger(n))
        .slice(0, 10);
      const probe = async (label: number) => {
        try {
          const raw = await withTimeout(
            getEquityData('news_label_search', {
              label,
              page: 1,
              page_size: 3,
            }),
            10_000,
          );
          const text = JSON.stringify(parseMaybeJson(raw));
          return {
            label,
            result: text.length > 1500 ? `${text.slice(0, 1500)}...` : text,
          };
        } catch (err) {
          return {
            label,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      };
      const out = await Promise.all([
        attempt({}),
        attempt({ category: 'news' }),
        attempt({ category: 'sentiment' }),
        attempt({ category: 'equity' }),
        attempt({ entry_id: 'news_label_search' }),
        attempt({ id: 'news_label_search' }),
      ]);
      const probes = await Promise.all(probeLabels.map(probe));
      return NextResponse.json({ discover: out, probes });
    }

    const question = body.question?.trim();
    if (!question) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 },
      );
    }

    const hints = (body.symbol ?? '')
      .toUpperCase()
      .split(/[\s,]+/)
      .filter((item) => /^[A-Z.]{1,6}$/.test(item));

    const [catalog, spotBases, thesisContext] = await Promise.all([
      loadCatalog(),
      loadSpotBases(),
      loadThesisContext(body.thesisId, loadDeckSnapshot),
    ]);
    timings.setupMs = Date.now() - t0;

    const spotSymbolByTicker = new Map<string, string>();
    for (const row of catalog) {
      if (row.underlyingTicker)
        spotSymbolByTicker.set(row.underlyingTicker.toUpperCase(), row.symbol);
    }
    const stockTickers = new Set(spotSymbolByTicker.keys());

    const cryptoBases = findCryptoMentions(question, spotBases, stockTickers);
    const stockTargets = findMentions(question, catalog)
      .map((item) => item.ticker)
      .filter((ticker) => !cryptoBases.includes(ticker));
    for (const hint of hints) {
      if (stockTargets.includes(hint) || cryptoBases.includes(hint)) continue;
      if (stockTickers.has(hint)) stockTargets.push(hint);
      else if (spotBases.has(hint)) cryptoBases.push(hint);
    }
    // A question like "what could disprove it?" names no stock. Fall back to the open thesis.
    if (thesisContext && !stockTargets.length && !cryptoBases.length) {
      for (const item of thesisContext.thesis.tickers) {
        if (stockTickers.has(item.symbol)) stockTargets.push(item.symbol);
      }
    }
    const stocks = stockTargets.slice(0, 4);
    const coins = cryptoBases.slice(0, 3);
    const symbol = [...stocks, ...coins].join(', ') || undefined;

    const marketOpen = usMarketOpenNow();
    const tEvidence = Date.now();
    const stockPromises = stocks.map(async (ticker, index) => {
      const spot = spotSymbolByTicker.get(ticker);
      const wantExtras = index < EXTRA_STOCK_LIMIT;
      const [quote, week, tk, extras] = await Promise.all([
        withHedge(
          () =>
            mcpCore(
              () => getEquityData('equity_price_quote', { symbol: ticker }),
              QUOTE_TIMEOUT_MS,
            ),
          QUOTE_HEDGE_MS,
        ).then(
          (raw) => ({
            data: parseMaybeJson(raw),
            error: null as string | null,
          }),
          (err: unknown) => ({
            data: null,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
        spot
          ? withTimeout(weeklyChange(spot), SPOT_TIMEOUT_MS).catch(() => null)
          : Promise.resolve(null),
        spot
          ? withTimeout(fetchSpotTicker(spot), SPOT_TIMEOUT_MS).catch(
              () => null,
            )
          : Promise.resolve(null),
        wantExtras ? softExtras(ticker) : Promise.resolve([] as ExtraResult[]),
      ]);
      const last = num(tk?.lastPr);
      const open = num(tk?.open);
      const underlying = slimQuote(quote.data);
      const underlyingLast = underlying?.last_price ?? null;
      const premiumPct =
        last !== null && underlyingLast
          ? (last / underlyingLast - 1) * 100
          : null;
      return {
        kind: 'stock',
        symbol: ticker,
        spotSymbol: spot ?? null,
        spotTicker: tk
          ? {
              lastPr: tk.lastPr,
              open: tk.open,
              high24h: tk.high24h,
              low24h: tk.low24h,
            }
          : null,
        computed: {
          change24hPct: last !== null && open ? (last / open - 1) * 100 : null,
        },
        rTokenBasis: {
          rTokenLast: last,
          underlyingLast,
          premiumPct,
          usMarketOpenNow: marketOpen,
        },
        underlyingQuote: underlying,
        research: extras,
        week,
        error: quote.error,
      };
    });
    const cryptoPromises = coins.map((base) =>
      withTimeout(getCryptoEvidence(base), SPOT_TIMEOUT_MS * 2).catch(
        (err: unknown) => ({
          kind: 'crypto',
          asset: base,
          symbol: `${base}USDT`,
          data: null,
          week: null,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
    const historyTargets = [
      ...stocks.map((name) => ({ name, symbol: spotSymbolByTicker.get(name) })),
      ...coins.map((name) => ({
        name,
        symbol: `${name}USDT` as string | undefined,
      })),
    ].filter((target): target is { name: string; symbol: string } =>
      Boolean(target.symbol),
    );
    const [stockEvidence, cryptoEvidence, marketMood, histories] =
      await Promise.all([
        Promise.all(stockPromises),
        Promise.all(cryptoPromises),
        stocks.length || coins.length
          ? loadMarketMood()
          : Promise.resolve(null),
        Promise.all(
          historyTargets.map(async (target) => ({
            name: target.name,
            closes: await loadCloses(target.symbol),
          })),
        ),
      ]);
    timings.evidenceMs = Date.now() - tEvidence;

    const allEvidence = [...stockEvidence, ...cryptoEvidence];
    const mcpEvidence: unknown = allEvidence.length ? allEvidence : null;
    const failed = allEvidence.filter((item) => item.error);
    const mcpError: string | null = failed.length
      ? failed
          .map(
            (item) =>
              `${'asset' in item ? item.asset : item.symbol}: ${item.error}`,
          )
          .join('; ')
      : null;

    // Precomputed gaps, so the model never does the arithmetic or the ranking itself.
    type Pctable = {
      week?: { changePct?: number } | null;
      computed?: { change24hPct?: number | null };
    };
    const round2 = (value: number) => Math.round(value * 100) / 100;
    const named = [
      ...stockEvidence.map((item) => ({
        name: item.symbol,
        item: item as Pctable,
      })),
      ...cryptoEvidence.map((item) => ({
        name: item.asset,
        item: item as unknown as Pctable,
      })),
    ];
    const gap = (
      aName: string,
      a: number | null | undefined,
      bName: string,
      b: number | null | undefined,
    ) =>
      typeof a === 'number' && typeof b === 'number'
        ? {
            [aName]: round2(a),
            [bName]: round2(b),
            spreadPts: round2(a - b),
            leader: a === b ? 'tie' : a > b ? aName : bName,
          }
        : null;
    const comparisons: Array<Record<string, unknown>> = [];
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length && comparisons.length < 12; j++) {
        const a = named[i];
        const b = named[j];
        comparisons.push({
          pair: `${a.name} vs ${b.name}`,
          week7d: gap(
            a.name,
            a.item.week?.changePct,
            b.name,
            b.item.week?.changePct,
          ),
          change24h: gap(
            a.name,
            a.item.computed?.change24hPct,
            b.name,
            b.item.computed?.change24hPct,
          ),
        });
      }
    }

    // Historical distribution from up to 90 daily candles, computed here and not by the model.
    const weeklyByName = new Map<string, Map<string, number>>();
    for (const item of histories)
      if (item.closes) weeklyByName.set(item.name, rollingWeek(item.closes));
    const historyAssets: Record<string, unknown> = {};
    for (const [name, weekly] of weeklyByName)
      historyAssets[name] = assetHistory(weekly);
    const historyPairs: Array<Record<string, unknown>> = [];
    const historyNames = [...weeklyByName.keys()];
    for (let i = 0; i < historyNames.length; i++) {
      for (
        let j = i + 1;
        j < historyNames.length && historyPairs.length < 12;
        j++
      ) {
        const stats = pairHistory(
          weeklyByName.get(historyNames[i])!,
          weeklyByName.get(historyNames[j])!,
        );
        if (stats)
          historyPairs.push({
            pair: `${historyNames[i]} vs ${historyNames[j]}`,
            ...stats,
          });
      }
    }
    const history = weeklyByName.size
      ? {
          lookbackDays: HISTORY_DAYS,
          note: 'Rolling seven-day windows overlap, so independent weeks are about one seventh of the window count.',
          assets: historyAssets,
          pairs: historyPairs,
        }
      : null;

    // Which Bitget sources actually returned data for this question.
    const sources = new Set<string>();
    for (const item of stockEvidence) {
      if (item.underlyingQuote) sources.add('mcp:equity_price_quote');
      if (item.spotTicker) sources.add('rest:spot_ticker');
      if (item.week) sources.add('rest:spot_candles_1day');
      for (const extra of item.research)
        if (extra.data) sources.add(`mcp:${extra.entry}`);
    }
    for (const item of cryptoEvidence) {
      if (item.data) sources.add('rest:spot_ticker');
      if (item.week) sources.add('rest:spot_candles_1day');
    }
    if (history) sources.add('rest:spot_candles_90d');
    if (marketMood?.usMarketFearGreed)
      sources.add('mcp:sentiment_market_fear_greed');
    if (marketMood?.cryptoFearGreed)
      sources.add('mcp:crypto_sentiment_crypto_fear_greed');
    const sourceList = [...sources];

    const systemPrompt = `You are Uncle, a market research assistant for a Bitget Reality Thesis Desk. You help a human trader stress test an idea. You never decide for them.
${UNCLE_VOICE}
STRICT RULES:
1. EVIDENCE FIRST: Base answers only on the provided Bitget evidence.
2. HONEST UNCERTAINTY: If data is missing, say so. Never invent prices, estimates, news or company facts.
3. READ-ONLY: No trades, orders, or investment recommendations.
4. DOMAIN: Discuss tokenized US stocks (Bitget rTokens) and Bitget-listed crypto spot pairs. No wallets, on-chain smart money, or assets without evidence below.
5. PLAIN WORDS: Write for a first-time trader. Say where a number comes from in everyday words, such as the 7-day price change, the current Bitget price, analyst price targets, analyst consensus, the earnings calendar or the 90-day history. Never write raw field or entry names such as week.changePct, spotTicker, computed.change24hPct, p10Pct, p90Pct, worstPct, spreadPts or equity_estimates_price_target. Explain any finance term in a few words the first time you use it.
6. COVERAGE: Evidence holds one entry per instrument named in the question. If the question names an asset with no evidence, say which one is missing and answer for the rest.
7. COMPARISONS: The comparisons block holds precomputed gaps between instruments in percentage points. Quote spreadPts and leader from it. Never subtract, rank or judge which number is higher yourself. A less negative change beats a more negative one, so -1.5 percent leads -2.5 percent. If only one instrument was named, comparisons is empty by design, so say nothing about it and never list it under Data gaps.
8. SAME MEASURE: Stocks here are Bitget rTokens that trade 24/7 like crypto, so never say their market is closed. Compare assets with computed.change24hPct for the 24h move and week.changePct for the seven-day move. spotTicker is the tradable Bitget price. underlyingQuote is the US stock quote and follows US market hours.
9. RTOKEN BASIS: rTokenBasis.premiumPct is how far the rToken trades from the underlying US stock price. When usMarketOpenNow is false, the US stock price is the last session close, so a gap means the rToken is pricing news or flow after the close. Mention it only when the absolute premium is above 0.3 percent or the US market is closed and it matters to the question.
10. RESEARCH ENTRIES: Each stock may carry research items such as analyst consensus, analyst price targets, the earnings calendar and valuation ratios. Use them as supporting or conflicting evidence. An earnings date within the next 14 days belongs under What would change this view. If an item has error or no data, list it under Data gaps. If underlyingQuote is null, the US stock quote call failed, which is separate from the research items. The marketMood block holds market-wide fear and greed readings, not asset-specific ones. Use it at most once as backdrop and say it is market-wide.
11. FORECASTS: If the question asks what will happen, say you can't predict it, never answer yes or no, and test the idea against the past evidence instead.
12. HISTORY: The history block is the historical distribution of rolling seven-day returns from Bitget daily candles, computed in code. For each pair, firstBeatsSecondPct is the share of windows where the first asset beat the second. Explain the history in everyday words. A window is a rolling 7-day period. Say, for example, 83 rolling 7-day periods, which is only about 12 separate weeks because the periods share days, and never call them observations. p10Pct is a bad week, one of the worst 1 in 10. p90Pct is a strong week, one of the best 1 in 10. worstPct is the worst 7-day stretch in the last 90 days. firstBeatsSecondPct is the share of 7-day periods where the first asset beat the second. For each asset named in the thesis, add one bullet under Evidence against with a bad week figure and the worst 7-day stretch, so the downside is visible. Overlapping windows are not independent, so never describe the result as proof or as a trend that will continue. Lead Evidence for and Evidence against with it when present, and list it under Data gaps only when it is missing for an instrument that was named. With one instrument, history.pairs is empty by design, so use history.assets alone.
13. FORMAT: Plain text only, no markdown symbols except a hyphen at the start of a bullet. Write the opening from the VOICE section first, then a blank line, then use exactly these labels, each on its own line, in this order:
Verdict: one sentence that says whether the latest week and the history agree on the idea.
Evidence for: up to 3 hyphen bullets.
Evidence against: up to 3 hyphen bullets.
What would change this view: 1 or 2 hyphen bullets naming a specific measurable signal.
Data gaps: one line, or "None" if nothing is missing.
14. THESIS: If a thesis block is present, it is the idea under test. Name its title in the opening and judge it against the evidence. The momentum reading is price data only, so never say it proves or disproves the thesis. Use the thesis only when the question relates to it, and ignore it if the trader moved on to something else.
15. LENGTH: Under 270 words in total, opening included.`;

    const userPrompt = `${questionBlock(question, body.priorMessages)}
Instruments found in the question: ${symbol || 'none'}
${thesisContext ? thesisContext.block + '\n' : ''}
Time now (UTC): ${new Date().toISOString()}

Bitget evidence:
${mcpEvidence ? JSON.stringify(mcpEvidence) : 'No Bitget data available.'}
comparisons: ${JSON.stringify(comparisons)}
history: ${history ? JSON.stringify(history) : 'unavailable'}
marketMood: ${marketMood ? JSON.stringify(marketMood) : 'unavailable'}
${mcpError ? `Evidence error: ${mcpError}` : ''}`;

    const debug = {
      version: 'universal-v13',
      catalogRows: catalog.length,
      spotBases: spotBases.size,
      stocks,
      coins,
      extraEntries: EXTRA_ENTRIES,
      timings,
    };
    console.log('[Research API] matched', JSON.stringify(debug));

    const provenance = {
      symbol: symbol || null,
      instrumentId: body.instrumentId || null,
      mcpSource: 'bitget_data',
      mcpEntryId: sourceList.length ? sourceList.join(' + ') : null,
      sources: sourceList,
      sourceCount: sourceList.length,
      timestamp: new Date().toISOString(),
      mcpError,
    };

    const base = process.env.QWEN_BASE_URL;
    const key = process.env.QWEN_API_KEY;
    if (!base || !key) {
      return NextResponse.json(
        {
          error:
            'Qwen is not configured on the server (QWEN_BASE_URL / QWEN_API_KEY).',
          provenance,
          rawEvidence: mcpEvidence,
          debug,
        },
        { status: 503 },
      );
    }

    const tQwen = Date.now();
    const qwenResponse = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.QWEN_MODEL || 'qwen3.8-max',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 800,
        enable_thinking: false,
      }),
      signal: AbortSignal.timeout(40_000),
    });

    if (!qwenResponse.ok) {
      const errText = await qwenResponse.text();
      throw new Error(`Qwen API failed: ${qwenResponse.status} - ${errText}`);
    }

    const qwenData = (await qwenResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    timings.qwenMs = Date.now() - tQwen;
    timings.totalMs = Date.now() - t0;
    const answer =
      qwenData.choices?.[0]?.message?.content?.trim() ||
      'No response generated.';

    // Source Lock: every figure in the reply must match the evidence it was written from.
    // Figures the trader typed (now or earlier in this chat) are theirs, and the thesis block
    // carries the momentum reading the model was shown, so both count as supported.
    const traderText = [
      question,
      ...sanitizePriorMessages(body.priorMessages)
        .filter((m) => m.role === 'user')
        .map((m) => m.content),
    ].join(' ');
    const locked = lockAnswer(
      answer,
      [
        mcpEvidence,
        comparisons,
        history,
        marketMood,
        thesisContext?.block ?? null,
      ],
      traderText,
    );
    const lockedProvenance = {
      ...provenance,
      sourceLock: {
        checked: locked.checked,
        verified: locked.verified,
        withheld: locked.withheld.length,
        refused: locked.refused,
        // Stocks here are tokens of US shares. When the US market is shut their price can be thin or stale.
        usMarketClosed: stocks.length > 0 && !usMarketOpen(new Date()),
      },
    };

    return NextResponse.json({
      question,
      answer: locked.text,
      debug,
      provenance: lockedProvenance,
      marketMood,
      comparisons,
      history,
      rawEvidence: mcpEvidence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Research API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
