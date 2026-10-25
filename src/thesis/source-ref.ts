// Where a displayed Bitget number came from. Pure, so the server that builds
// it and the tests that check it share one definition.
import { usMarketOpen } from './evidence';

export interface SourceRef {
  /** For example "Bitget daily candles". */
  label: string;
  instrumentId: string | null;
  /** Timestamp of the newest candle or quote the number rests on. */
  observedAt: string | null;
  /** Timestamp of the oldest candle in the window, for changes over a window. */
  windowStart: string | null;
  /** How many candles the number was computed from. */
  candles: number | null;
  fetchedAt: string;
  /** True when the US cash market was shut at the observed time or when fetched. */
  marketClosed: boolean;
}

export function buildSourceRef(input: {
  label: string;
  instrumentId: string | null;
  observedAt: string | null;
  windowStart?: string | null;
  candles?: number | null;
  fetchedAt: Date;
}): SourceRef {
  const observed = input.observedAt ? new Date(input.observedAt) : null;
  const observedValid = observed !== null && Number.isFinite(observed.getTime());
  return {
    label: input.label,
    instrumentId: input.instrumentId,
    observedAt: observedValid ? observed.toISOString() : null,
    windowStart: input.windowStart ?? null,
    candles: input.candles ?? null,
    fetchedAt: input.fetchedAt.toISOString(),
    // A price whose time is unknown is judged by the fetch time alone.
    marketClosed:
      !usMarketOpen(input.fetchedAt) || (observedValid ? !usMarketOpen(observed) : false),
  };
}

/** The kind of figure on screen decides how it is described. */
export type FigureKind =
  | 'close'
  | 'candle'
  | 'candle_move'
  | 'range'
  | 'day_change'
  | 'window_change'
  | 'average'
  | 'quote'
  | 'count';

export interface FigureNote {
  /** observed: read from Bitget. computed: arithmetic done by this app. */
  state: 'observed' | 'computed';
  how: string;
}

export function describeFigure(kind: FigureKind, ref: SourceRef): FigureNote {
  const n = ref.candles;
  switch (kind) {
    case 'close':
      return { state: 'observed', how: 'The latest daily close Bitget returned.' };
    case 'candle':
      return { state: 'observed', how: 'A daily candle value exactly as Bitget returned it.' };
    case 'candle_move':
      return {
        state: 'computed',
        how: "Computed by this app: that day's close compared with its open.",
      };
    case 'range':
      return {
        state: 'computed',
        how: `Computed by this app: the highest high and lowest low among the ${n ?? 'listed'} daily candles.`,
      };
    case 'quote':
      return { state: 'observed', how: 'Read from the Bitget MCP equity quote.' };
    case 'day_change':
      return {
        state: 'computed',
        how: 'Computed by this app: the latest daily close minus the one before it, divided by the one before it.',
      };
    case 'window_change':
      return {
        state: 'computed',
        how: `Computed by this app: the last daily close compared with the first${n ? `, across ${n} daily candles` : ''}.`,
      };
    case 'average':
      return {
        state: 'computed',
        how: 'Computed by this app: the plain average of the listed stocks that returned data.',
      };
    case 'count':
      return {
        state: 'computed',
        how: 'Counted by this app from the listed stocks that returned data.',
      };
  }
}

/** One reference for a figure built from several stocks: the newest observation, and closed if any input was. */
export function combineRefs(refs: SourceRef[], label: string): SourceRef | null {
  if (refs.length === 0) return null;
  const newest = (key: 'observedAt' | 'fetchedAt') =>
    refs
      .map((r) => r[key])
      .filter((v): v is string => v !== null)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return {
    label,
    instrumentId: null,
    observedAt: newest('observedAt'),
    windowStart: null,
    candles: null,
    fetchedAt: newest('fetchedAt') ?? refs[0].fetchedAt,
    marketClosed: refs.some((r) => r.marketClosed),
  };
}
