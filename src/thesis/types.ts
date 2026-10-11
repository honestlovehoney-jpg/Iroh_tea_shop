// Shared contract for the deck config, the /api/theses routes, and the deck UI.

export type ThesisId = 'robinhood' | 'bullrun' | 'ai';

export interface Ticker {
  /** Underlying ticker, e.g. AAPL. Resolved to a Bitget instrument via the catalog. */
  symbol: string;
  name: string;
  assetClass: 'stock';
}

export interface Thesis {
  id: ThesisId;
  numeral: 'I' | 'II' | 'III';
  title: string;
  subtitle: string;
  body: string;
  spirit: string;
  image: string;
  /** Hue in degrees, used to tint glows such as the Cross Beam background. */
  hue: number;
  colors: { primary: string; accent: string; ink: string };
  tickers: Ticker[];
}

export type ConvictionLevel = 'weak' | 'steeping' | 'strong' | 'unknown';

/**
 * Price-momentum breadth for one thesis: how many of its stocks rose over the
 * candle window. It summarizes Bitget price data. It does not say the thesis is right.
 */
export interface Conviction {
  level: ConvictionLevel;
  /** Tickers whose price rose over the window. */
  rising: number;
  /** Tickers that returned usable candles. */
  measured: number;
  /** Mean percent price change across measured tickers. */
  avgChangePct: number | null;
}

export interface TickerSignal {
  symbol: string;
  status: 'ok' | 'empty' | 'error';
  /** Percent price change from the first to the last close in the window. */
  changePct: number | null;
  lastClose: number | null;
  /** Canonical Bitget Reality instrument id, when the catalog knows the ticker. */
  instrumentId: string | null;
}

export interface ThesisSummary {
  id: ThesisId;
  conviction: Conviction;
  tickers: TickerSignal[];
}

export type SnapshotMeta = {
  fetchedAt: string;
  expiresAt: string;
  source: 'bitget';
  stale: boolean;
};

export type DeckSnapshot = { theses: ThesisSummary[] } & SnapshotMeta;

export type Section<T> =
  | { status: 'ok'; data: T }
  | { status: 'empty' }
  | { status: 'unavailable'; reason: string }
  | { status: 'not-applicable' };

export interface CandleRow {
  /** ISO timestamp of the candle open. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface CandleEvidence {
  /** Oldest first. */
  rows: CandleRow[];
  changePct: number | null;
  high: number;
  low: number;
}

export interface QuoteEvidence {
  lastPrice: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface TickerDetail {
  thesisId: ThesisId;
  symbol: string;
  instrumentId: string | null;
  fetchedAt: string;
  stale: boolean;
  candles: Section<CandleEvidence>;
  quote: Section<QuoteEvidence>;
}

/** Error body for every /api/theses response that is not 200. */
export interface DeckError {
  error: string;
}

export interface MarketRow {
  symbol: string;
  name: string;
  status: 'ok' | 'empty' | 'error';
  lastClose: number | null;
  /** Percent change from the previous daily close to the latest close. */
  dayChangePct: number | null;
  /** Percent change from the first to the last close in the window. */
  weekChangePct: number | null;
  /** Daily closes, oldest first, for the small chart. */
  closes: number[];
  instrumentId: string | null;
}

export interface MarketSummary {
  measured: number;
  risingToday: number;
  dayMeasured: number;
  risingWeek: number;
  weekMeasured: number;
  avgDayPct: number | null;
  avgWeekPct: number | null;
  leader: { symbol: string; dayChangePct: number } | null;
  laggard: { symbol: string; dayChangePct: number } | null;
}

export type MarketBoard = {
  rows: MarketRow[];
  summary: MarketSummary;
} & SnapshotMeta;
