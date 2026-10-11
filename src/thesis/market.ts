import { percentChange, windowChange } from './momentum';
import type { MarketRow, MarketSummary } from './types';

/** The Observatorium board: a benchmark first, then the largest names. */
export const MAJORS: { symbol: string; name: string }[] = [
  { symbol: 'SPY', name: 'S&P 500 ETF' },
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'JPM', name: 'JPMorgan' },
  { symbol: 'V', name: 'Visa' },
];

/** Price figures from daily closes, oldest first. */
export function marketMetrics(closes: number[]) {
  const last = closes.length ? closes[closes.length - 1] : null;
  return {
    lastClose: last,
    dayChangePct:
      closes.length >= 2
        ? percentChange(closes[closes.length - 2], closes[closes.length - 1])
        : null,
    weekChangePct: windowChange(closes),
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

/** Breadth and extremes across the rows that have data. */
export function summarizeMarket(rows: MarketRow[]): MarketSummary {
  const ok = rows.filter((row) => row.status === 'ok');
  const day = ok.filter((row) => row.dayChangePct !== null);
  const week = ok.filter((row) => row.weekChangePct !== null);
  const sorted = [...day].sort(
    (a, b) => (b.dayChangePct as number) - (a.dayChangePct as number),
  );
  const pick = (row: MarketRow | undefined) =>
    row ? { symbol: row.symbol, dayChangePct: row.dayChangePct as number } : null;
  return {
    measured: ok.length,
    risingToday: day.filter((row) => (row.dayChangePct as number) > 0).length,
    dayMeasured: day.length,
    risingWeek: week.filter((row) => (row.weekChangePct as number) > 0).length,
    weekMeasured: week.length,
    avgDayPct: mean(day.map((row) => row.dayChangePct as number)),
    avgWeekPct: mean(week.map((row) => row.weekChangePct as number)),
    leader: day.length > 1 ? pick(sorted[0]) : null,
    laggard: day.length > 1 ? pick(sorted[sorted.length - 1]) : null,
  };
}
