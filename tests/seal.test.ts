import { describe, expect, it } from 'vitest';
import {
  baseRate,
  brier,
  calibration,
  outcomeFor,
  parseSystemProbability,
  resolvesAtFor,
  resolvingClose,
  validateSealInput,
} from '../src/thesis/seal';

describe('validateSealInput', () => {
  const good = { direction: 'up', probability: 0.65, horizonDays: 14 };
  it('accepts a direction, a probability and a horizon', () => {
    expect(validateSealInput(good).ok).toBe(true);
  });
  it.each([0, 1, 0.005, 1.2, Number.NaN, '0.6'])(
    'rejects probability %s',
    (probability) => {
      expect(validateSealInput({ ...good, probability }).ok).toBe(false);
    },
  );
  it.each([0, 91, 1.5, -3, '7'])('rejects horizon %s', (horizonDays) => {
    expect(validateSealInput({ ...good, horizonDays }).ok).toBe(false);
  });
  it('rejects a missing or unknown direction and non-objects', () => {
    expect(validateSealInput({ ...good, direction: 'sideways' }).ok).toBe(
      false,
    );
    expect(validateSealInput(null).ok).toBe(false);
  });
});

describe('resolvesAtFor and resolvingClose', () => {
  it('lands at the end of the UTC day the horizon falls on', () => {
    const at = resolvesAtFor(new Date('2026-10-24T15:30:00Z'), 7);
    expect(at.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  const closes = [
    { timestamp: '2026-10-31T00:00:00Z', close: 110 },
    { timestamp: '2026-11-01T00:00:00Z', close: 120 },
  ];
  it('uses the daily close of the horizon day, and only once that day has ended', () => {
    const at = new Date('2026-11-01T00:00:00Z');
    expect(
      resolvingClose(closes, at, new Date('2026-10-31T23:00:00Z')),
    ).toBeNull();
    expect(
      resolvingClose(closes, at, new Date('2026-11-01T01:00:00Z'))?.close,
    ).toBe(110);
    expect(resolvingClose([], at, new Date('2026-11-02T00:00:00Z'))).toBeNull();
  });
});

describe('outcome and Brier score', () => {
  it('judges up and down, with a tie counting as no', () => {
    expect(outcomeFor('up', 100, 101)).toBe(true);
    expect(outcomeFor('up', 100, 100)).toBe(false);
    expect(outcomeFor('down', 100, 99)).toBe(true);
    expect(outcomeFor('down', 100, 100)).toBe(false);
  });
  it('scores 0 for perfect confidence that was right, 1 for wrong, 0.25 for a coin flip', () => {
    expect(brier(1, true)).toBe(0);
    expect(brier(0, true)).toBe(1);
    expect(brier(0.5, true)).toBe(0.25);
    expect(Math.abs(brier(0.7, false) - 0.49) < 1e-12).toBe(true);
    expect(Math.abs(brier(0.7, true) - 0.09) < 1e-12).toBe(true);
  });
});

describe('baseRate', () => {
  const rising = Array.from({ length: 40 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
    close: 100 + i,
  }));
  it('is 1 for a steadily rising series and 0 for down', () => {
    expect(baseRate(rising, 7, 'up')).toBe(1);
    expect(baseRate(rising, 7, 'down')).toBe(0);
  });
  it('is null without enough windows', () => {
    expect(baseRate(rising.slice(0, 12), 7, 'up')).toBeNull();
  });
});

describe('parseSystemProbability', () => {
  it('reads fenced JSON and percent-style numbers', () => {
    const a = parseSystemProbability(
      '```json\n{"probability":0.62,"rationale":"Momentum is mixed."}\n```',
    );
    expect(a?.probability).toBe(0.62);
    expect(
      parseSystemProbability('{"probability":"62","rationale":"x"}')
        ?.probability,
    ).toBe(0.62);
  });
  it('rejects certainty, out-of-range values and prose', () => {
    expect(
      parseSystemProbability('{"probability":1,"rationale":"x"}'),
    ).toBeNull();
    expect(
      parseSystemProbability('{"probability":0,"rationale":"x"}'),
    ).toBeNull();
    expect(parseSystemProbability('{"probability":250}')).toBeNull();
    expect(parseSystemProbability('I think it is likely.')).toBeNull();
  });
});

describe('calibration', () => {
  const seal = (u: number, s: number, outcome: boolean) => ({
    userProbability: u,
    systemProbability: s,
    outcome,
    userBrier: brier(u, outcome),
    systemBrier: brier(s, outcome),
    resolvedAt: '2026-11-01T00:00:00Z',
  });
  it('names who scored lower and reports the hit rate', () => {
    const result = calibration([seal(0.9, 0.6, false), seal(0.8, 0.6, true)]);
    expect(result.resolved).toBe(2);
    expect(result.better).toBe('uncle');
    expect(result.hitRate).toBe(0.5);
  });
  it('is empty with nothing resolved', () => {
    const result = calibration([]);
    expect(result.userMeanBrier).toBeNull();
    expect(result.better).toBeNull();
  });
});
