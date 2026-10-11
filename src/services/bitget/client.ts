import 'server-only';

const DEFAULT_BASE_URL = 'https://api.bitget.com';
const REQUEST_TIMEOUT_MS = 10_000;

export class BitgetApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BitgetApiError';
  }
}

type BitgetEnvelope<T> = {
  code?: string;
  msg?: string;
  message?: string;
  requestTime?: number | string;
  data?: T;
};

function baseUrl(): string {
  return (process.env.BITGET_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

async function get<T>(path: string): Promise<BitgetEnvelope<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BitgetApiError(
        `Bitget request failed with HTTP ${response.status}`,
        `HTTP_${response.status}`,
        response.status,
      );
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BitgetApiError('Bitget returned an invalid JSON envelope', 'INVALID_ENVELOPE', 502);
    }
    const envelope = raw as BitgetEnvelope<T>;
    if (envelope.code && envelope.code !== '00000') {
      throw new BitgetApiError(
        envelope.msg || envelope.message || 'Bitget returned an API error',
        envelope.code,
        502,
      );
    }
    return envelope;
  } catch (error) {
    if (error instanceof BitgetApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BitgetApiError('Bitget request timed out', 'TIMEOUT', 504);
    }
    throw new BitgetApiError('Unable to reach Bitget', 'NETWORK_ERROR', 502);
  } finally {
    clearTimeout(timeout);
  }
}

export type RawStockInfo = {
  symbol?: unknown;
  code?: unknown;
  name?: unknown;
  tradingPeriod?: unknown;
  weekendTradable?: unknown;
};

export async function fetchStockCatalog(): Promise<{
  records: RawStockInfo[];
  requestTime: string | null;
}> {
  const envelope = await get<RawStockInfo[]>('/api/v3/reality/market/stock-info');
  if (!Array.isArray(envelope.data)) {
    throw new BitgetApiError('Bitget stock catalog data was not an array', 'INVALID_CATALOG', 502);
  }
  return {
    records: envelope.data,
    requestTime: envelope.requestTime == null ? null : String(envelope.requestTime),
  };
}

export async function fetchSpotCandles(input: {
  symbol: string;
  granularity?: string;
  limit?: number;
}): Promise<{ rows: unknown[]; requestTime: string | null }> {
  const symbol = encodeURIComponent(input.symbol);
  const granularity = encodeURIComponent(input.granularity || '1day');
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 3)));
  const envelope = await get<unknown[]>(
    `/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`,
  );
  if (!Array.isArray(envelope.data)) {
    throw new BitgetApiError('Bitget candle data was not an array', 'INVALID_CANDLES', 502);
  }
  return {
    rows: envelope.data,
    requestTime: envelope.requestTime == null ? null : String(envelope.requestTime),
  };
}

export type RawSpotSymbol = {
  symbol?: unknown;
  baseCoin?: unknown;
  quoteCoin?: unknown;
  status?: unknown;
};

/** Public list of Bitget spot pairs, used to recognise coin tickers in a question. */
export async function fetchSpotSymbols(): Promise<RawSpotSymbol[]> {
  const envelope = await get<RawSpotSymbol[]>('/api/v2/spot/public/symbols');
  if (!Array.isArray(envelope.data)) {
    throw new BitgetApiError('Bitget spot symbol data was not an array', 'INVALID_SYMBOLS', 502);
  }
  return envelope.data;
}

/** Public 24h ticker for one spot pair, passed through as Bitget returns it. */
export async function fetchSpotTicker(symbol: string): Promise<Record<string, unknown> | null> {
  const envelope = await get<Array<Record<string, unknown>>>(
    `/api/v2/spot/market/tickers?symbol=${encodeURIComponent(symbol)}`,
  );
  const first = Array.isArray(envelope.data) ? envelope.data[0] : null;
  return first && typeof first === 'object' ? first : null;
}
