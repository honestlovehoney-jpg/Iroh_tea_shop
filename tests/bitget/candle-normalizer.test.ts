import { describe, expect, it } from 'vitest';
import { normalizeCandleRows } from '@/services/bitget/candle-normalizer';

describe('Bitget candle normalizer', () => {
  it('normalizes valid OHLCV rows and preserves optional volumes', () => {
    expect(normalizeCandleRows([
      ['1791504000000', '210', '215', '208', '213.5', '1200', '255000'],
      ['1791417600000', 205, 212, 202, 210],
    ])).toEqual([
      {
        timestamp: '2026-10-09T00:00:00.000Z',
        open: 210, high: 215, low: 208, close: 213.5,
        baseVolume: 1200, quoteVolume: 255000,
      },
      {
        timestamp: '2026-10-08T00:00:00.000Z',
        open: 205, high: 212, low: 202, close: 210,
        baseVolume: null, quoteVolume: null,
      },
    ]);
  });

  it('drops malformed rows rather than fabricating zero values', () => {
    expect(normalizeCandleRows([
      null,
      ['bad-timestamp', '1', '2', '0.5', '1.5'],
      ['1791504000000', '1', '2'],
      ['1791504000000', '1', '2', '0.5', '1.5'],
    ])).toHaveLength(1);
  });
});
