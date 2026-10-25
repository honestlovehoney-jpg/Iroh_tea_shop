import { describe, expect, test } from 'vitest';
import {
  buildUncleDraft,
  convictionSentence,
  convictionTitle,
  formatPct,
  formatPrice,
  formatRelative,
  risingLine,
  shareText,
} from '../src/ui/deckModel';
import { THESES } from '../src/thesis/deck';
import type { ThesisSummary } from '../src/thesis/types';

const thesis = THESES[0];
const summary = (
  level: ThesisSummary['conviction']['level'],
): ThesisSummary => ({
  id: thesis.id,
  conviction: { level, rising: 3, measured: 4, avgChangePct: 2.5 },
  tickers: [],
});

describe('deck model', () => {
  test('formats percentages and prices', () => {
    expect(formatPct(2.54, true)).toBe('+2.5%');
    expect(formatPct(-1.26, true)).toBe('-1.3%');
    expect(formatPct(null)).toBe('—');
    expect(formatPrice(335.2)).toBe('$335.20');
    expect(formatPrice(null)).toBe('—');
  });

  test('describes momentum in plain words', () => {
    expect(convictionTitle('strong')).toBe('Strong momentum');
    expect(convictionTitle('unknown')).toBe('No momentum signal');
    const { conviction } = summary('strong');
    expect(risingLine(conviction, 4)).toBe('3 of 4 rising');
    expect(convictionSentence(conviction, 4)).toBe(
      '3 of 4 stocks rose over the last 7 days',
    );
    expect(convictionSentence({ ...conviction, measured: 3 }, 4)).toContain(
      '(3 with data)',
    );
  });

  test('the Uncle draft and share text never mention the old data source', () => {
    const texts = [
      buildUncleDraft(thesis, summary('strong')),
      buildUncleDraft(thesis, null),
      shareText(thesis, summary('weak')),
      shareText(thesis, null),
    ];
    for (const text of texts)
      expect(text.toLowerCase()).not.toContain('nansen');
    expect(buildUncleDraft(thesis, summary('strong'))).toContain('strong');
  });

  test('formats relative times', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(formatRelative('2026-10-11T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative(null, now)).toBe('time unknown');
  });
});
