import { NextResponse } from 'next/server';
import { db } from '@/auth/db';
import { callMcpTool, getEquityData } from '@/services/bitget/mcp-client';
import { fetchSpotTicker } from '@/services/bitget/client';
import { findCryptoMentions, findMentions } from '@/services/bitget/mentions';
import { getCryptoEvidence, loadSpotBases, weeklyChange } from '@/services/bitget/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const EXTRA_TIMEOUT_MS = 5_000;
const EXTRA_MAX_CHARS = 700;
const EXTRA_STOCK_LIMIT = 3;
const QUOTE_TIMEOUT_MS = 8_000;
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

type CatalogRow = { underlyingTicker: string | null; companyName: string | null; symbol: string };
let catalogCache: { at: number; rows: CatalogRow[] } | null = null;

async function loadCatalog(): Promise<CatalogRow[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.rows;
  const rows = await db.bitgetAsset.findMany({
    select: { underlyingTicker: true, companyName: true, symbol: true },
  });
  catalogCache = { at: Date.now(), rows };
  return rows;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
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
  const waiters: Array<{ run: () => void; cancelled: boolean; granted: boolean }> = [];

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
      return await withTimeout(fn(), Math.max(1000, ms - (Date.now() - started)));
    } finally {
      release();
    }
  };
}

const mcpCore = makeLimiter(CORE_CONCURRENCY);
const mcpExtras = makeLimiter(EXTRAS_CONCURRENCY);

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function num(value: unknown): number | null {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Keep only the fields Uncle needs from the underlying US stock quote. */
function slimQuote(raw: unknown) {
  const row = (raw as { data?: { results?: Array<Record<string, unknown>> } } | null)?.data
    ?.results?.[0];
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
  const body = Array.isArray(results) ? results.slice(0, 3) : (parsed?.data ?? parsed);
  if (body === null || body === undefined) return null;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > EXTRA_MAX_CHARS ? `${text.slice(0, EXTRA_MAX_CHARS)}...` : text;
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
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

type ExtraResult = { entry: string; data: string | null; error: string | null };
const extraCache = new Map<string, { at: number; data: string }>();

async function fetchExtra(entryId: string, ticker: string): Promise<ExtraResult> {
  const key = `${entryId}:${ticker}`;
  const hit = extraCache.get(key);
  if (hit && Date.now() - hit.at < EXTRA_CACHE_TTL_MS) {
    return { entry: entryId, data: hit.data, error: null };
  }
  try {
    const raw = await mcpExtras(
      () => getEquityData(entryId, { symbol: ticker, ...(ENTRY_PARAMS[entryId] ?? {}) }),
      ENTRY_TIMEOUT_MS[entryId] ?? EXTRA_TIMEOUT_MS,
    );
    const summary = slimExtra(raw);
    if (summary) {
      if (extraCache.size > 400) extraCache.clear();
      extraCache.set(key, { at: Date.now(), data: summary });
    }
    return { entry: entryId, data: summary, error: summary ? null : 'Empty result' };
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
  const late = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), EXTRAS_SOFT_MS));
  return Promise.all(
    EXTRA_ENTRIES.map(async (entry) => {
      const result = await Promise.race([fetchExtra(entry, ticker), late]);
      if (result === 'late') {
        return { entry, data: null, error: 'Still loading, cached for the next question' };
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
  if (moodCache && Date.now() - moodCache.at < MOOD_TTL_MS) return moodCache.data;
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
  if (usMarketFearGreed || cryptoFearGreed) moodCache = { at: Date.now(), data };
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
      discover?: boolean;
      probeLabels?: number[];
    };

    // Protected helper: list what the Bitget MCP guide says about news and sentiment entries.
    if (body.discover) {
      const token = process.env.BITGET_CATALOG_SYNC_TOKEN;
      if (!token || request.headers.get('authorization') !== `Bearer ${token}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const attempt = async (args: Record<string, unknown>) => {
        try {
          return { args, result: parseMaybeJson(await withTimeout(callMcpTool('guide', args), 10_000)) };
        } catch (err) {
          return { args, error: err instanceof Error ? err.message : String(err) };
        }
      };
      const probeLabels = (Array.isArray(body.probeLabels) ? body.probeLabels : [])
        .map(Number)
        .filter((n) => Number.isInteger(n))
        .slice(0, 10);
      const probe = async (label: number) => {
        try {
          const raw = await withTimeout(
            getEquityData('news_label_search', { label, page: 1, page_size: 3 }),
            10_000,
          );
          const text = JSON.stringify(parseMaybeJson(raw));
          return { label, result: text.length > 1500 ? `${text.slice(0, 1500)}...` : text };
        } catch (err) {
          return { label, error: err instanceof Error ? err.message : String(err) };
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
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    const hints = (body.symbol ?? '')
      .toUpperCase()
      .split(/[\s,]+/)
      .filter((item) => /^[A-Z.]{1,6}$/.test(item));

    const [catalog, spotBases] = await Promise.all([loadCatalog(), loadSpotBases()]);
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
    const stocks = stockTargets.slice(0, 4);
    const coins = cryptoBases.slice(0, 3);
    const symbol = [...stocks, ...coins].join(', ') || undefined;

    const marketOpen = usMarketOpenNow();
    const tEvidence = Date.now();
    const stockPromises = stocks.map(async (ticker, index) => {
      const spot = spotSymbolByTicker.get(ticker);
      const wantExtras = index < EXTRA_STOCK_LIMIT;
      const [quote, week, tk, extras] = await Promise.all([
        mcpCore(() => getEquityData('equity_price_quote', { symbol: ticker }), QUOTE_TIMEOUT_MS).then(
          (raw) => ({ data: parseMaybeJson(raw), error: null as string | null }),
          (err: unknown) => ({
            data: null,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
        spot
          ? withTimeout(weeklyChange(spot), SPOT_TIMEOUT_MS).catch(() => null)
          : Promise.resolve(null),
        spot
          ? withTimeout(fetchSpotTicker(spot), SPOT_TIMEOUT_MS).catch(() => null)
          : Promise.resolve(null),
        wantExtras
          ? softExtras(ticker)
          : Promise.resolve([] as ExtraResult[]),
      ]);
      const last = num(tk?.lastPr);
      const open = num(tk?.open);
      const underlying = slimQuote(quote.data);
      const underlyingLast = underlying?.last_price ?? null;
      const premiumPct =
        last !== null && underlyingLast ? (last / underlyingLast - 1) * 100 : null;
      return {
        kind: 'stock',
        symbol: ticker,
        spotSymbol: spot ?? null,
        spotTicker: tk
          ? { lastPr: tk.lastPr, open: tk.open, high24h: tk.high24h, low24h: tk.low24h }
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
      withTimeout(getCryptoEvidence(base), SPOT_TIMEOUT_MS * 2).catch((err: unknown) => ({
        kind: 'crypto',
        asset: base,
        symbol: `${base}USDT`,
        data: null,
        week: null,
        error: err instanceof Error ? err.message : String(err),
      })),
    );
    const [stockEvidence, cryptoEvidence, marketMood] = await Promise.all([
      Promise.all(stockPromises),
      Promise.all(cryptoPromises),
      stocks.length || coins.length ? loadMarketMood() : Promise.resolve(null),
    ]);
    timings.evidenceMs = Date.now() - tEvidence;

    const allEvidence = [...stockEvidence, ...cryptoEvidence];
    const mcpEvidence: unknown = allEvidence.length ? allEvidence : null;
    const failed = allEvidence.filter((item) => item.error);
    const mcpError: string | null = failed.length
      ? failed
          .map((item) => `${'asset' in item ? item.asset : item.symbol}: ${item.error}`)
          .join('; ')
      : null;

    // Precomputed gaps, so the model never does the arithmetic or the ranking itself.
    type Pctable = { week?: { changePct?: number } | null; computed?: { change24hPct?: number | null } };
    const round2 = (value: number) => Math.round(value * 100) / 100;
    const named = [
      ...stockEvidence.map((item) => ({ name: item.symbol, item: item as Pctable })),
      ...cryptoEvidence.map((item) => ({ name: item.asset, item: item as unknown as Pctable })),
    ];
    const gap = (aName: string, a: number | null | undefined, bName: string, b: number | null | undefined) =>
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
          week7d: gap(a.name, a.item.week?.changePct, b.name, b.item.week?.changePct),
          change24h: gap(a.name, a.item.computed?.change24hPct, b.name, b.item.computed?.change24hPct),
        });
      }
    }

    // Which Bitget sources actually returned data for this question.
    const sources = new Set<string>();
    for (const item of stockEvidence) {
      if (item.underlyingQuote) sources.add('mcp:equity_price_quote');
      if (item.spotTicker) sources.add('rest:spot_ticker');
      if (item.week) sources.add('rest:spot_candles_1day');
      for (const extra of item.research) if (extra.data) sources.add(`mcp:${extra.entry}`);
    }
    for (const item of cryptoEvidence) {
      if (item.data) sources.add('rest:spot_ticker');
      if (item.week) sources.add('rest:spot_candles_1day');
    }
    if (marketMood?.usMarketFearGreed) sources.add('mcp:sentiment_market_fear_greed');
    if (marketMood?.cryptoFearGreed) sources.add('mcp:crypto_sentiment_crypto_fear_greed');
    const sourceList = [...sources];

    const systemPrompt = `You are Uncle, a market research assistant for a Bitget Reality Thesis Desk. You help a human trader stress test an idea. You never decide for them.
STRICT RULES:
1. EVIDENCE FIRST: Base answers only on the provided Bitget evidence.
2. HONEST UNCERTAINTY: If data is missing, say so. Never invent prices, estimates, news or company facts.
3. READ-ONLY: No trades, orders, or investment recommendations.
4. DOMAIN: Discuss tokenized US stocks (Bitget rTokens) and Bitget-listed crypto spot pairs. No wallets, on-chain smart money, or assets without evidence below.
5. PROVENANCE: Name the field or research entry you rely on, for example week.changePct or equity_estimates_consensus.
6. COVERAGE: Evidence holds one entry per instrument named in the question. If the question names an asset with no evidence, say which one is missing and answer for the rest.
7. COMPARISONS: The comparisons block holds precomputed gaps between instruments in percentage points. Quote spreadPts and leader from it. Never subtract, rank or judge which number is higher yourself. A less negative change beats a more negative one, so -1.5 percent leads -2.5 percent.
8. SAME MEASURE: Stocks here are Bitget rTokens that trade 24/7 like crypto, so never say their market is closed. Compare assets with computed.change24hPct for the 24h move and week.changePct for the seven-day move. spotTicker is the tradable Bitget price. underlyingQuote is the US stock quote and follows US market hours.
9. RTOKEN BASIS: rTokenBasis.premiumPct is how far the rToken trades from the underlying US stock price. When usMarketOpenNow is false, the US stock price is the last session close, so a gap means the rToken is pricing news or flow after the close. Mention it only when the absolute premium is above 0.3 percent or the US market is closed and it matters to the question.
10. RESEARCH ENTRIES: Each stock may carry research items such as analyst consensus, analyst price targets, the earnings calendar and valuation ratios. Use them as supporting or conflicting evidence. An earnings date within the next 14 days belongs under What would change this view. If an item has error or no data, list it under Data gaps. The marketMood block holds market-wide fear and greed readings, not asset-specific ones. Use it at most once as backdrop and say it is market-wide.
11. FORECASTS: If the question asks what will happen, say you can't predict it, never answer yes or no, and test the idea against the past evidence instead.
12. FORMAT: Plain text only, no markdown symbols except a hyphen at the start of a bullet. Use exactly these labels, each on its own line, in this order:
Verdict: one sentence describing what the evidence shows so far.
Evidence for: up to 3 hyphen bullets.
Evidence against: up to 3 hyphen bullets.
What would change this view: 1 or 2 hyphen bullets naming a specific measurable signal.
Data gaps: one line, or "None" if nothing is missing.
13. LENGTH: Under 220 words in total.`;

    const userPrompt = `User question: "${question}"
Instruments found in the question: ${symbol || 'none'}
Time now (UTC): ${new Date().toISOString()}

Bitget evidence:
${mcpEvidence ? JSON.stringify(mcpEvidence) : 'No Bitget data available.'}
comparisons: ${JSON.stringify(comparisons)}
marketMood: ${marketMood ? JSON.stringify(marketMood) : 'unavailable'}
${mcpError ? `Evidence error: ${mcpError}` : ''}`;

    const debug = {
      version: 'universal-v9',
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
          error: 'Qwen is not configured on the server (QWEN_BASE_URL / QWEN_API_KEY).',
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
        max_tokens: 700,
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

    return NextResponse.json({
      question,
      answer,
      debug,
      provenance,
      marketMood,
      comparisons,
      rawEvidence: mcpEvidence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Research API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
