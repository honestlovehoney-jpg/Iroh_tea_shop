import { describe, expect, test } from 'vitest';
import { computeConviction } from '../src/thesis/conviction';
import type { TickerSignal } from '../src/thesis/types';

const signal = (
  overrides: Partial<TickerSignal> & Pick<TickerSignal, 'symbol'>,
): TickerSignal => ({
  status: 'ok',
  changePct: 0,
  lastClose: 100,
  instrumentId: 'RTESTUSDT',
  ...overrides,
});

describe('computeConviction', () => {
  test('returns unknown when nothing is measured', () => {
    expect(computeConviction([])).toEqual({
      level: 'unknown',
      rising: 0,
      measured: 0,
      avgChangePct: null,
    });
    expect(
      computeConviction([
        signal({ symbol: 'A', status: 'empty', changePct: null }),
        signal({ symbol: 'B', status: 'error', changePct: null }),
      ]),
    ).toMatchObject({ level: 'unknown', measured: 0, avgChangePct: null });
  });

  test('counts a flat stock as measured but not rising', () => {
    expect(
      computeConviction([
        signal({ symbol: 'A', changePct: 0 }),
        signal({ symbol: 'B', changePct: -10 }),
      ]),
    ).toEqual({ level: 'weak', rising: 0, measured: 2, avgChangePct: -5 });
  });

  test('reads Building at half and Strong at three quarters', () => {
    const half = computeConviction([
      signal({ symbol: 'A', changePct: 4 }),
      signal({ symbol: 'B', changePct: -2 }),
    ]);
    expect(half.level).toBe('steeping');
    const strong = computeConviction([
      signal({ symbol: 'A', changePct: 1 }),
      signal({ symbol: 'B', changePct: 2 }),
      signal({ symbol: 'C', changePct: 3 }),
      signal({ symbol: 'D', changePct: -1 }),
    ]);
    expect(strong).toMatchObject({ level: 'strong', rising: 3, measured: 4 });
  });

  test('ignores stocks without usable candles', () => {
    expect(
      computeConviction([
        signal({ symbol: 'A', changePct: 5 }),
        signal({ symbol: 'B', status: 'error', changePct: null }),
      ]),
    ).toMatchObject({ level: 'strong', rising: 1, measured: 1 });
  });
});
