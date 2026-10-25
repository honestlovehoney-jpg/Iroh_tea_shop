import { describe, expect, it } from 'vitest';
import {
  computeRisk,
  correlation,
  decideLock,
  validatePortfolio,
  validatePosition,
  worstWindow,
  type Close,
  type Portfolio,
} from '../src/thesis/risk';

const series = (fn: (i: number) => number, n = 60): Close[] =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
    close: fn(i),
  }));
const wave = (i: number) => 100 + 5 * Math.sin(i / 3) + i * 0.1;

const base: Portfolio = { totalUsd: 10_000, collateralUsd: null, marginUsedUsd: null, holdings: [] };
const run = (portfolio: Portfolio, plannedUsd: number, extra: Record<string, unknown> = {}) =>
  computeRisk({
    portfolio,
    position: { plannedUsd, leverage: 1 },
    symbol: 'AAPL',
    closes: series(wave),
    holdingCloses: new Map(),
    marketClosed: false,
    ...extra,
  });
const metric = (r: ReturnType<typeof run>, key: string) => r.metrics.find((m) => m.key === key)!;

describe('validatePortfolio and validatePosition', () => {
  it('accepts cash only, holdings, and collateral', () => {
    expect(validatePortfolio({ totalUsd: 5000 }).ok).toBe(true);
    const p = validatePortfolio({ totalUsd: 5000, holdings: [{ symbol: 'nvda', valueUsd: 1000 }, { symbol: 'NVDA', valueUsd: 500 }], collateralUsd: 2000, marginUsedUsd: 500 });
    expect(p.ok && p.value.holdings).toEqual([{ symbol: 'NVDA', valueUsd: 1500 }]);
  });
  it('rejects bad totals, over-allocation and margin without collateral', () => {
    expect(validatePortfolio({ totalUsd: 0 }).ok).toBe(false);
    expect(validatePortfolio({ totalUsd: 1000, holdings: [{ symbol: 'AAPL', valueUsd: 2000 }] }).ok).toBe(false);
    expect(validatePortfolio({ totalUsd: 1000, marginUsedUsd: 100 }).ok).toBe(false);
    expect(validatePortfolio({ totalUsd: 1000, collateralUsd: 100, marginUsedUsd: 200 }).ok).toBe(false);
    expect(validatePortfolio({ totalUsd: 1000, holdings: [{ symbol: 'bad symbol!', valueUsd: 5 }] }).ok).toBe(false);
  });
  it('checks position size and leverage', () => {
    expect(validatePosition({ plannedUsd: 500 }).ok).toBe(true);
    expect(validatePosition({ plannedUsd: 0 }).ok).toBe(false);
    expect(validatePosition({ plannedUsd: 500, leverage: 0.5 }).ok).toBe(false);
    expect(validatePosition({ plannedUsd: 500, leverage: 50 }).ok).toBe(false);
  });
});

describe('correlation and worstWindow', () => {
  it('is 1 for the same series, about -1 for the mirror, null with no variation', () => {
    const a = series(wave);
    expect(Math.abs(correlation(a, a)! - 1) < 1e-9).toBe(true);
    const mirror = series((i) => 200 - wave(i) + 100);
    expect(correlation(a, mirror)! < -0.9).toBe(true);
    expect(correlation(a, series(() => 100))).toBeNull();
    expect(correlation(a.slice(0, 10), a.slice(0, 10))).toBeNull();
  });
  it('finds the worst 3-day fall and needs enough history', () => {
    const closes = series((i) => (i === 30 ? 80 : 100));
    expect(Math.abs(worstWindow(closes, 3)! - -0.2) < 1e-9).toBe(true);
    expect(worstWindow(series(wave, 10), 3)).toBeNull();
  });
});

describe('computeRisk', () => {
  it('clears a small position in a cash portfolio', () => {
    const r = run(base, 500);
    expect(metric(r, 'concentration').level).toBe('ok');
    expect(r.verdict === 'clear' || r.verdict === 'warn').toBe(true);
    expect(metric(r, 'correlation').level).toBe('ok');
    expect(metric(r, 'margin').label).toBe('Funding');
  });

  it('warns at 10% and blocks at 25% concentration, counting what you already hold', () => {
    expect(metric(run(base, 1200), 'concentration').level).toBe('warn');
    expect(metric(run(base, 2600), 'concentration').level).toBe('block');
    // 2000 already held plus 600 new is 26% of the portfolio.
    const holding = run({ ...base, holdings: [{ symbol: 'AAPL', valueUsd: 2000 }] }, 600);
    expect(metric(holding, 'concentration').level).toBe('block');
    expect(Math.abs(metric(holding, 'concentration').value! - 0.26) < 1e-9).toBe(true);
    const smaller = run({ ...base, holdings: [{ symbol: 'AAPL', valueUsd: 500 }] }, 600);
    expect(metric(smaller, 'concentration').level).toBe('warn');
  });

  it('flags highly correlated holdings, and says what it could not measure', () => {
    const portfolio: Portfolio = {
      ...base,
      holdings: [{ symbol: 'MSFT', valueUsd: 5000 }, { symbol: 'PRIV', valueUsd: 1000 }],
    };
    const r = run(portfolio, 500, { holdingCloses: new Map([['MSFT', series(wave)]]) });
    const c = metric(r, 'correlation');
    expect(c.level).toBe('block');
    expect(c.message).toContain('PRIV');
    const none = run(portfolio, 500, { holdingCloses: new Map() });
    expect(metric(none, 'correlation').level).toBe('unmeasured');
  });

  it('turns a historical gap into a share of the portfolio', () => {
    const jumpy = series((i) => (i >= 30 && i < 33 ? 100 - (i - 29) * 10 : i >= 33 ? 70 : 100));
    const r = run(base, 5000, { closes: jumpy });
    const g = metric(r, 'gap');
    expect(g.level === 'block' || g.level === 'warn').toBe(true);
    expect(g.value! > 0.1).toBe(true);
    const flagged = run(base, 500, { marketClosed: true });
    expect(metric(flagged, 'gap').message).toContain('closed');
  });

  it('measures margin against collateral and funding against free cash', () => {
    const collateral = run({ ...base, collateralUsd: 2000, marginUsedUsd: 1000 }, 2000, {
      position: { plannedUsd: 2000, leverage: 2 },
    });
    expect(metric(collateral, 'margin').value).toBe(1);
    expect(metric(collateral, 'margin').level).toBe('block');
    const broke = run({ ...base, holdings: [{ symbol: 'MSFT', valueUsd: 10_000 }] }, 100);
    expect(metric(broke, 'margin').level).toBe('block');
  });

  it('leaves the gap unmeasured without enough candles', () => {
    expect(metric(run(base, 500, { closes: null }), 'gap').level).toBe('unmeasured');
  });
});

describe('decideLock', () => {
  const clear = run(base, 500);
  const warned = run(base, 1200);
  const blocked = run(base, 2600);

  it('lets a clear report lock with nothing to acknowledge', () => {
    const d = decideLock({ ...clear, needsAck: [], hasBlock: false, verdict: 'clear' }, { acknowledged: [], overrideReason: '' });
    expect(d.ok && d.verdict).toBe('clear');
  });
  it('needs each warned metric acknowledged by name', () => {
    expect(decideLock(warned, { acknowledged: [], overrideReason: '' }).ok).toBe(false);
    const ok = decideLock(warned, { acknowledged: warned.needsAck, overrideReason: '' });
    expect(ok.ok && ok.verdict).toBe('warn');
  });
  it('needs a written reason to go past a hard block, and keeps it', () => {
    expect(decideLock(blocked, { acknowledged: blocked.needsAck, overrideReason: 'short' }).ok).toBe(false);
    const ok = decideLock(blocked, { acknowledged: blocked.needsAck, overrideReason: 'I am hedged with puts on the same name.' });
    expect(ok.ok && ok.verdict).toBe('override');
    expect(ok.ok && ok.overrideReason).toContain('hedged');
  });
});
