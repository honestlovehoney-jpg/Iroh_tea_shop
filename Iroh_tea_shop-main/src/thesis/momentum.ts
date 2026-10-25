/** Eight daily candles span seven days of price change. */
export const CANDLE_WINDOW = 8;

export function percentChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

/** Oldest first, without mutating the input. */
export function sortCandles<T extends { timestamp: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
}

/** Percent change from the first to the last close, or null with fewer than two closes. */
export function windowChange(closes: number[]): number | null {
  if (closes.length < 2) return null;
  return percentChange(closes[0], closes[closes.length - 1]);
}

/**
 * Finds the first object that has a numeric `last_price`, anywhere in a
 * Bitget MCP quote answer. The answer's wrapper has varied, so search it.
 */
export function findQuoteObject(
  value: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 4 || value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(value) && 'last_price' in record) return record;
  const children = Array.isArray(value) ? value : Object.values(record);
  for (const child of children) {
    const found = findQuoteObject(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
