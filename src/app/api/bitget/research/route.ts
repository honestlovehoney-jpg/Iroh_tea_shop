import { NextResponse } from 'next/server';
import { db } from '@/auth/db';
import { getEquityData } from '@/services/bitget/mcp-client';
import { fetchSpotTicker } from '@/services/bitget/client';
import { findCryptoMentions, findMentions } from '@/services/bitget/mentions';
import { getCryptoEvidence, loadSpotBases, weeklyChange } from '@/services/bitget/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATALOG_TTL_MS = 10 * 60 * 1000;
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

/** Keep only the fields Uncle needs from the underlying US stock quote. */
function slimQuote(raw: unknown) {
  const row = (raw as { data?: { results?: Array<Record<string, unknown>> } } | null)?.data
    ?.results?.[0];
  if (!row) return null;
  return {
    last_price: row.last_price ?? null,
    prev_close: row.prev_close ?? null,
    change_percent: row.change_percent ?? null,
  };
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
    };
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

    const tEvidence = Date.now();
    const stockPromises = stocks.map(async (ticker) => {
      const spot = spotSymbolByTicker.get(ticker);
      const [quote, week, tk] = await Promise.all([
        getEquityData('equity_price_quote', { symbol: ticker }).then(
          (raw) => {
            try {
              return {
                data: typeof raw === 'string' ? JSON.parse(raw) : raw,
                error: null as string | null,
              };
            } catch {
              return { data: raw, error: null as string | null };
            }
          },
          (err: unknown) => ({
            data: null,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
        spot ? weeklyChange(spot) : Promise.resolve(null),
        spot ? fetchSpotTicker(spot).catch(() => null) : Promise.resolve(null),
      ]);
      const last = Number(tk?.lastPr);
      const open = Number(tk?.open);
      return {
        kind: 'stock',
        symbol: ticker,
        spotSymbol: spot ?? null,
        spotTicker: tk
          ? { lastPr: tk.lastPr, open: tk.open, high24h: tk.high24h, low24h: tk.low24h }
          : null,
        computed: {
          change24hPct: Number.isFinite(last) && open ? (last / open - 1) * 100 : null,
        },
        underlyingQuote: slimQuote(quote.data),
        week,
        error: quote.error,
      };
    });
    const cryptoPromises = coins.map((base) => getCryptoEvidence(base));
    const [stockEvidence, cryptoEvidence] = await Promise.all([
      Promise.all(stockPromises),
      Promise.all(cryptoPromises),
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

    const systemPrompt = `You are a market research assistant for a Bitget Reality Thesis Desk.
STRICT RULES:
1. EVIDENCE FIRST: Base answers only on the provided Bitget MCP data.
2. HONEST UNCERTAINTY: If data is missing, say so. Never invent prices or company facts.
3. READ-ONLY: No trades, orders, or investment recommendations.
4. DOMAIN: Discuss tokenized US stocks (Reality instruments) and Bitget-listed crypto spot pairs. No wallets, on-chain smart money, or assets without evidence below.
5. PROVENANCE: Cite specific fields from the evidence when available.
6. COVERAGE: Evidence holds one entry per instrument named in the question. If the question names an asset that has no evidence below, say which one is missing and answer for the rest. Stocks here are Bitget rTokens that trade 24/7 like crypto, so never say their market is closed. For both stocks and crypto, use computed.change24hPct for the 24h move and week.changePct for the seven-day move, so every comparison uses the same measure. For stocks, spotTicker is the tradable Bitget price and underlyingQuote is the US stock quote, which follows US market hours and is reference only.
7. FORECASTS: If the question asks what will happen, say you can't predict it, compare the past window only, and never answer yes or no.
8. LENGTH: Keep answers under 150 words.`;

    const userPrompt = `User question: "${question}"
Instruments found in the question: ${symbol || 'none'}

MCP evidence:
${mcpEvidence ? JSON.stringify(mcpEvidence) : 'No MCP data available.'}
${mcpError ? `MCP error: ${mcpError}` : ''}`;

    const debug = {
      version: 'universal-v4',
      catalogRows: catalog.length,
      spotBases: spotBases.size,
      stocks,
      coins,
      timings,
    };
    console.log('[Research API] matched', JSON.stringify(debug));

    const base = process.env.QWEN_BASE_URL;
    const key = process.env.QWEN_API_KEY;
    if (!base || !key) {
      return NextResponse.json(
        {
          error:
            'Qwen is not configured on the server (QWEN_BASE_URL / QWEN_API_KEY).',
          provenance: {
            symbol: symbol || null,
            instrumentId: body.instrumentId || null,
            mcpSource: 'bitget_data',
            mcpEntryId: allEvidence.length ? 'equity_price_quote + spot_ticker' : null,
            timestamp: new Date().toISOString(),
            mcpError,
          },
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
        max_tokens: 450,
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
      provenance: {
        symbol: symbol || null,
        instrumentId: body.instrumentId || null,
        mcpSource: 'bitget_data',
        mcpEntryId: allEvidence.length ? 'equity_price_quote + spot_ticker' : null,
        timestamp: new Date().toISOString(),
        mcpError,
      },
      rawEvidence: mcpEvidence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Research API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
