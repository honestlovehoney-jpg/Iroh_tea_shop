import type { NormalizedCandle } from './types';

function numeric(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Bitget candle rows are [timestamp, open, high, low, close, baseVolume, quoteVolume]. */
export function normalizeCandleRows(rows: unknown[]): NormalizedCandle[] {
  return rows.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 5) return [];
    const timestamp = numeric(row[0]);
    const open = numeric(row[1]);
    const high = numeric(row[2]);
    const low = numeric(row[3]);
    const close = numeric(row[4]);
    if ([timestamp, open, high, low, close].some((value) => value === null))
      return [];
    const date = new Date(timestamp as number);
    if (Number.isNaN(date.getTime())) return [];
    return [
      {
        timestamp: date.toISOString(),
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        baseVolume: numeric(row[5]),
        quoteVolume: numeric(row[6]),
      },
    ];
  });
}
