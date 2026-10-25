import { describe, expect, it } from 'vitest';
import { buildSourceRef, combineRefs, describeFigure } from '../src/thesis/source-ref';

const midday = new Date('2026-10-28T16:00:00Z'); // 12:00 New York, open
const saturday = new Date('2026-10-24T16:00:00Z');

describe('buildSourceRef', () => {
  it('is not flagged closed when both the observation and the fetch were in market hours', () => {
    const ref = buildSourceRef({
      label: 'Bitget daily candles',
      instrumentId: 'RAAPLUSDT',
      observedAt: '2026-10-28T15:00:00Z',
      windowStart: '2026-10-21T00:00:00Z',
      candles: 8,
      fetchedAt: midday,
    });
    expect(ref.marketClosed).toBe(false);
    expect(ref.candles).toBe(8);
    expect(ref.observedAt).toBe('2026-10-28T15:00:00.000Z');
  });

  it('flags closed on a weekend fetch, or when the observation was after hours', () => {
    expect(
      buildSourceRef({ label: 'x', instrumentId: null, observedAt: null, fetchedAt: saturday }).marketClosed,
    ).toBe(true);
    expect(
      buildSourceRef({
        label: 'x',
        instrumentId: null,
        observedAt: '2026-10-28T22:00:00Z',
        fetchedAt: midday,
      }).marketClosed,
    ).toBe(true);
  });

  it('ignores an unreadable observation time instead of throwing', () => {
    const ref = buildSourceRef({ label: 'x', instrumentId: null, observedAt: 'soon', fetchedAt: midday });
    expect(ref.observedAt).toBeNull();
    expect(ref.marketClosed).toBe(false);
  });
});

describe('describeFigure', () => {
  const ref = buildSourceRef({ label: 'x', instrumentId: null, observedAt: null, candles: 8, fetchedAt: midday });
  it('marks closes and quotes observed, and changes and averages computed', () => {
    expect(describeFigure('close', ref).state).toBe('observed');
    expect(describeFigure('quote', ref).state).toBe('observed');
    expect(describeFigure('day_change', ref).state).toBe('computed');
    expect(describeFigure('average', ref).state).toBe('computed');
    expect(describeFigure('window_change', ref).how).toContain('8 daily candles');
  });
});

describe('combineRefs', () => {
  it('takes the newest times and flags closed when any input was closed', () => {
    const a = buildSourceRef({ label: 'a', instrumentId: 'A', observedAt: '2026-10-28T15:00:00Z', fetchedAt: midday });
    const b = buildSourceRef({ label: 'b', instrumentId: 'B', observedAt: '2026-10-28T15:30:00Z', fetchedAt: midday });
    const closed = buildSourceRef({ label: 'c', instrumentId: 'C', observedAt: '2026-10-28T22:00:00Z', fetchedAt: midday });
    const open = combineRefs([a, b], 'two stocks')!;
    expect(open.observedAt).toBe('2026-10-28T15:30:00.000Z');
    expect(open.marketClosed).toBe(false);
    expect(combineRefs([a, closed], 'two')!.marketClosed).toBe(true);
    expect(combineRefs([], 'none')).toBeNull();
  });
});
