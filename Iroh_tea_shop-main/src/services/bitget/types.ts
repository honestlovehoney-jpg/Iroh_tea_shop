/** Canonical Bitget Reality stock instrument, independent of company enrichment. */
export type BitgetAsset = {
  provider: 'bitget';
  providerInstrumentId: string;
  symbol: string;
  underlyingTicker: string;
  companyName: string | null;
  tradingPeriod: unknown;
  weekendTradable: string | null;
  sourceRequestTime: string | null;
  firstSeenAt: string;
  lastVerifiedAt: string;
};

export type SignalStatus =
  | 'available'
  | 'unsupported'
  | 'unavailable'
  | 'stale'
  | 'error';

export type NormalizedCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  baseVolume: number | null;
  quoteVolume: number | null;
};

export type NormalizedSignal<T> = {
  instrumentId: string;
  signalType: 'candles';
  status: SignalStatus;
  value: T | null;
  source: 'bitget';
  observedAt: string | null;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  errorCode?: string;
  errorMessage?: string;
};
