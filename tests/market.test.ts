import { describe, expect, test } from 'vitest';
import { MAJORS, marketMetrics, summarizeMarket } from '../src/thesis/market';
import type { MarketRow } from '../src/thesis/types';

const row = (
  symbol: string,
  dayChangePct: number | null,
  weekChangePct: number | null,
  status: MarketRow['status'] = 'ok',
): MarketRow => ({
  symbol,
  name: symbol,
  status,
  lastClose: 100,
  dayChangePct,
  weekChangePct,
  closes: [],
  instrumentId: null,
});

describe('marketMetrics', () => {
  test('reads the day move from the last two closes and the week move from the first and last', () => {
    const metrics = marketMetrics([100, 102, 104, 103, 105, 106, 108, 110]);
    expect(metrics.lastClose).toBe(110);
    expect(metrics.dayChangePct).toBeCloseTo(((110 - 108) / 108) * 100);
    expect(metrics.weekChangePct).toBeCloseTo(10);
  });
  test('has no moves without two closes', () => {
    expect(marketMetrics([])).toEqual({
      lastClose: null,
      dayChangePct: null,
      weekChangePct: null,
    });
    expect(marketMetrics([50])).toMatchObject({
      lastClose: 50,
      dayChangePct: null,
    });
  });
});

describe('summarizeMarket', () => {
  test('counts breadth, averages, leader and laggard', () => {
    const summary = summarizeMarket([
      row('A', 3, 5),
      row('B', -1, 2),
      row('C', 1, -4),
      row('D', null, null, 'empty'),
    ]);
    expect(summary).toMatchObject({
      measured: 3,
      risingToday: 2,
      dayMeasured: 3,
      risingWeek: 2,
      weekMeasured: 3,
      leader: { symbol: 'A', dayChangePct: 3 },
      laggard: { symbol: 'B', dayChangePct: -1 },
    });
    expect(summary.avgDayPct).toBeCloseTo(1);
    expect(summary.avgWeekPct).toBeCloseTo(1);
  });
  test('shows no extremes for a single stock or none', () => {
    expect(summarizeMarket([row('A', 2, 2)]).leader).toBeNull();
    expect(summarizeMarket([])).toMatchObject({
      measured: 0,
      avgDayPct: null,
      leader: null,
      laggard: null,
    });
  });
});

describe('MAJORS', () => {
  test('has unique symbols and leads with the benchmark', () => {
    const symbols = MAJORS.map((m) => m.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(symbols[0]).toBe('SPY');
  });
});
