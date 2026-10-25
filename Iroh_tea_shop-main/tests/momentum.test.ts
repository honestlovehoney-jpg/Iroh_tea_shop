import { describe, expect, test } from 'vitest';
import {
  findQuoteObject,
  numberOrNull,
  percentChange,
  sortCandles,
  windowChange,
} from '../src/thesis/momentum';

describe('percentChange', () => {
  test('computes the change and refuses a zero or invalid base', () => {
    expect(percentChange(100, 110)).toBeCloseTo(10);
    expect(percentChange(200, 150)).toBeCloseTo(-25);
    expect(percentChange(0, 5)).toBeNull();
    expect(percentChange(Number.NaN, 5)).toBeNull();
  });
});

describe('windowChange', () => {
  test('uses the first and last close', () => {
    expect(windowChange([100, 90, 120])).toBeCloseTo(20);
  });
  test('needs two closes', () => {
    expect(windowChange([])).toBeNull();
    expect(windowChange([100])).toBeNull();
  });
});

describe('sortCandles', () => {
  test('orders oldest first without changing the input', () => {
    const rows = [
      { timestamp: '2026-10-03T00:00:00.000Z' },
      { timestamp: '2026-10-01T00:00:00.000Z' },
      { timestamp: '2026-10-02T00:00:00.000Z' },
    ];
    expect(sortCandles(rows).map((r) => r.timestamp.slice(8, 10))).toEqual([
      '01',
      '02',
      '03',
    ]);
    expect(rows[0].timestamp.slice(8, 10)).toBe('03');
  });
});

describe('findQuoteObject', () => {
  test('finds the quote however the answer is wrapped', () => {
    const quote = { last_price: 335.02, open: 330 };
    expect(findQuoteObject(quote)).toBe(quote);
    expect(findQuoteObject({ data: [quote] })).toBe(quote);
    expect(findQuoteObject({ result: { data: { rows: [quote] } } })).toBe(
      quote,
    );
  });
  test('returns null when there is no quote', () => {
    expect(findQuoteObject({ data: [] })).toBeNull();
    expect(findQuoteObject('text')).toBeNull();
    expect(findQuoteObject(null)).toBeNull();
  });
});

describe('numberOrNull', () => {
  test('parses numbers and numeric strings only', () => {
    expect(numberOrNull('335.02')).toBeCloseTo(335.02);
    expect(numberOrNull(7)).toBe(7);
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
  });
});
