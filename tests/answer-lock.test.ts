import { describe, expect, it } from 'vitest';
import { WITHHELD, evidenceNumbers, lockAnswer } from '../src/thesis/answer-lock';

const evidence = {
  stocks: [
    { name: 'NVDA', spotTicker: { last: 201.37 }, week: { changePct: -2.46 }, computed: { change24hPct: 1.2 } },
    { name: 'AAPL', week: { changePct: 3.04 }, timestamp: '2026-10-24T12:00:00Z' },
  ],
  history: { assets: { NVDA: { p10Pct: -6.8, worstPct: -11.52 } } },
  marketCap: 4.6e12,
};

describe('evidenceNumbers', () => {
  it('collects numbers from nested data and numeric text, as absolute values', () => {
    const numbers = evidenceNumbers(evidence);
    expect(numbers.includes(2.46)).toBe(true);
    expect(numbers.includes(201.37)).toBe(true);
    expect(evidenceNumbers({ a: '5.2% up, 1,234 shares' }).includes(1234)).toBe(true);
  });
});

describe('lockAnswer', () => {
  it('keeps figures that match the evidence, including rounded and sign-flipped ones', () => {
    const text =
      'NVDA trades near $201.37 and fell 2.5% over seven days. A bad week was about 6.8 percent down.';
    const result = lockAnswer(text, evidence);
    expect(result.refused).toBe(false);
    expect(result.withheld).toEqual([]);
    expect(result.text).toBe(text);
    expect(result.verified).toBe(3);
  });

  it('withholds a figure the evidence does not support and leaves the rest', () => {
    const result = lockAnswer(
      'NVDA trades near $201.37, with a price target of $250.00. The worst stretch was 11.5%.',
      evidence,
    );
    expect(result.refused).toBe(false);
    expect(result.withheld).toEqual(['$250.00']);
    expect(result.text).toContain(`price target of ${WITHHELD}.`);
    expect(result.text).toContain('$201.37');
  });

  it('does not accept a number that only matches by dropping precision it did not round to', () => {
    const result = lockAnswer('NVDA fell 2.9% this week.', evidence);
    expect(result.withheld).toEqual(['2.9%']);
  });

  it('reads magnitude words', () => {
    const ok = lockAnswer('The market value is about $4.6 trillion.', evidence);
    expect(ok.withheld).toEqual([]);
    const bad = lockAnswer('The market value is about $9.6 trillion.', evidence);
    expect(bad.withheld).toEqual(['$9.6 trillion']);
  });

  it('ignores years, dates, times, small counts and windows of days', () => {
    const result = lockAnswer(
      'On 2026-10-24 at 12:00 UTC, over 7 days and 90 days, 3 of 4 stocks rose in 2026, about 1 in 10 weeks.',
      evidence,
    );
    expect(result.checked).toBe(0);
    expect(result.text.includes(WITHHELD)).toBe(false);
  });

  it('lets the person own figures from their own question', () => {
    const result = lockAnswer(
      'If NVDA falls 20% as you ask, that is outside the 2.46% weekly move seen.',
      evidence,
      'What if NVDA falls 20%?',
    );
    expect(result.withheld).toEqual([]);
  });

  it('refuses the answer when most figures fail', () => {
    const result = lockAnswer(
      'NVDA is $310.10, AAPL is $188.20, and the week was up 9.9% for one and down 4.4% for the other.',
      evidence,
    );
    expect(result.refused).toBe(true);
    expect(result.text).toContain('Source Lock refused');
  });

  it('refuses any numeric claim when there is no evidence at all', () => {
    const result = lockAnswer('NVDA is at $201.37 today.', null);
    expect(result.refused).toBe(true);
  });

  it('passes an answer with no figures untouched', () => {
    const text = 'There is not enough evidence to say.';
    const result = lockAnswer(text, evidence);
    expect(result.text).toBe(text);
    expect(result.checked).toBe(0);
  });
});
