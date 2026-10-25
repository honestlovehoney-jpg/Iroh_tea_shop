import { describe, expect, it } from 'vitest';
import {
  buildMarketClaims,
  evidenceStatus,
  usMarketOpen,
  validateUserClaim,
} from '../src/thesis/evidence';

// Wednesday 2026-10-28, 15:00 UTC = 11:00 New York (EDT): open.
const open = new Date('2026-10-28T15:00:00Z');
// Saturday 2026-10-24, 15:00 UTC: closed.
const weekend = new Date('2026-10-24T15:00:00Z');

const daily = (n: number, start = 100) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
    close: start + i,
  }));

describe('usMarketOpen', () => {
  it('is open on a weekday morning and closed on weekends and after hours', () => {
    expect(usMarketOpen(open)).toBe(true);
    expect(usMarketOpen(weekend)).toBe(false);
    expect(usMarketOpen(new Date('2026-10-28T22:00:00Z'))).toBe(false); // 18:00 ET
    expect(usMarketOpen(new Date('2026-10-28T13:00:00Z'))).toBe(false); // 09:00 ET
  });

  it('follows New York daylight saving time', () => {
    // 2026-12-02 15:00 UTC = 10:00 EST (open); 14:00 UTC = 09:00 EST (closed).
    expect(usMarketOpen(new Date('2026-12-02T15:00:00Z'))).toBe(true);
    expect(usMarketOpen(new Date('2026-12-02T14:00:00Z'))).toBe(false);
  });
});

describe('buildMarketClaims', () => {
  const base = {
    symbol: 'AAPL',
    instrumentId: 'RAAPLUSDT',
    weekendTradable: 'yes',
    now: open,
  };

  it('binds an observed price with its source and timestamp', () => {
    const claims = buildMarketClaims({
      ...base,
      price: { price: 201.5, asOf: '2026-10-28T14:00:00Z' },
      daily: daily(10),
    });
    const price = claims.find((c) => c.key === 'last_price')!;
    expect(price.state).toBe('observed');
    expect(price.valueText).toBe('201.5');
    expect(price.sourceLabel).toContain('RAAPLUSDT');
    expect(price.observedAt).toBe('2026-10-28T14:00:00.000Z');
    expect(price.marketClosed).toBe(false);
  });

  it('flags a price seen while the reference market is closed', () => {
    const claims = buildMarketClaims({
      ...base,
      now: weekend,
      price: { price: 201.5, asOf: '2026-10-24T14:00:00Z' },
      daily: daily(10),
    });
    const price = claims.find((c) => c.key === 'last_price')!;
    expect(price.marketClosed).toBe(true);
    expect(price.note).toContain('closed');
  });

  it('marks a computed change as inference and shows its inputs', () => {
    const claims = buildMarketClaims({
      ...base,
      price: { price: 109, asOf: '2026-10-28T14:00:00Z' },
      daily: daily(10),
    });
    const change = claims.find((c) => c.key === 'change_window')!;
    expect(change.state).toBe('inferred');
    expect(change.valueText).toBe('+9.00%');
    expect(change.note).toContain('100');
    expect(change.note).toContain('109');
  });

  it('withholds a value it cannot support instead of guessing', () => {
    const claims = buildMarketClaims({ ...base, price: null, daily: daily(2) });
    const price = claims.find((c) => c.key === 'last_price')!;
    const change = claims.find((c) => c.key === 'change_window')!;
    expect(price.state).toBe('insufficient');
    expect(price.valueText).toBeNull();
    expect(change.state).toBe('insufficient');
    expect(change.valueText).toBeNull();
  });

  it('returns one withheld claim for a stock Bitget does not list', () => {
    const claims = buildMarketClaims({
      ...base,
      instrumentId: null,
      price: null,
      daily: null,
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].state).toBe('insufficient');
  });
});

describe('validateUserClaim', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const sec = {
    label: 'Apple FY2025 net sales',
    valueText: '$416 billion',
    sourceKind: 'sec_filing',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/example.htm',
    observedAt: '2026-10-31T00:00:00Z',
  };

  it('holds an SEC link on sec.gov amber until the page is read', () => {
    const result = validateUserClaim({ ...sec, observedAt: '2026-10-01' }, now);
    expect(result.ok && result.value.state).toBe('inferred');
    expect(result.ok && result.verify).toBe(true);
  });

  it('refuses an SEC claim linked to another host, a plain http link, or a future date', () => {
    expect(
      validateUserClaim(
        {
          ...sec,
          observedAt: '2026-10-01',
          sourceUrl: 'https://example.com/a',
        },
        now,
      ).ok,
    ).toBe(false);
    expect(
      validateUserClaim(
        { ...sec, observedAt: '2026-10-01', sourceUrl: 'http://www.sec.gov/a' },
        now,
      ).ok,
    ).toBe(false);
    expect(
      validateUserClaim({ ...sec, observedAt: '2026-10-31' }, now).ok,
    ).toBe(false);
  });

  it('refuses a host that only ends with the primary name', () => {
    const fake = validateUserClaim(
      { ...sec, observedAt: '2026-10-01', sourceUrl: 'https://notsec.gov/x' },
      now,
    );
    expect(fake.ok).toBe(false);
  });

  it('keeps a company release amber', () => {
    const result = validateUserClaim(
      {
        ...sec,
        sourceKind: 'company_release',
        sourceUrl: 'https://investor.example.com/q3',
        observedAt: '2026-10-01',
      },
      now,
    );
    expect(result.ok && result.value.state).toBe('inferred');
    expect(result.ok && result.verify).toBe(false);
  });

  it('accepts a Federal Reserve statement and refuses an unknown kind', () => {
    const fed = validateUserClaim(
      {
        ...sec,
        sourceKind: 'central_bank',
        sourceUrl: 'https://www.federalreserve.gov/newsevents/x.htm',
        observedAt: '2026-09-17',
      },
      now,
    );
    expect(fed.ok && fed.verify).toBe(true);
    expect(
      validateUserClaim(
        { ...sec, observedAt: '2026-10-01', sourceKind: 'blog' },
        now,
      ).ok,
    ).toBe(false);
  });
});

describe('evidenceStatus gate', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const fresh = '2026-10-28T10:00:00.000Z';
  const claim = (
    state: 'observed' | 'inferred' | 'insufficient',
    extra = {},
  ) => ({
    state,
    origin: 'system' as const,
    acknowledged: false,
    fetchedAt: fresh,
    ...extra,
  });

  it('needs at least one observed fact', () => {
    expect(evidenceStatus([], now).complete).toBe(false);
    expect(evidenceStatus([claim('insufficient')], now).complete).toBe(false);
    expect(evidenceStatus([claim('observed')], now).complete).toBe(true);
  });

  it('needs every inference acknowledged', () => {
    const open = evidenceStatus([claim('observed'), claim('inferred')], now);
    expect(open.complete).toBe(false);
    expect(open.unacknowledged).toBe(1);
    const done = evidenceStatus(
      [claim('observed'), claim('inferred', { acknowledged: true })],
      now,
    );
    expect(done.complete).toBe(true);
  });

  it('blocks stale Bitget evidence but not your own old sources', () => {
    const old = '2026-10-20T00:00:00.000Z';
    expect(
      evidenceStatus([claim('observed', { fetchedAt: old })], now).complete,
    ).toBe(false);
    expect(
      evidenceStatus(
        [claim('observed', { fetchedAt: old, origin: 'user' })],
        now,
      ).complete,
    ).toBe(true);
  });
});
