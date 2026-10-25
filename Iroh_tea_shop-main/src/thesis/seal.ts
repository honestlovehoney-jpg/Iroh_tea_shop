// Probability Seal rules: the statement being forecast, how it is judged, and
// how both forecasts are scored. Pure functions with no imports.

export type Direction = 'up' | 'down';
export const DIRECTIONS: readonly Direction[] = ['up', 'down'];
export const MIN_HORIZON_DAYS = 1;
export const MAX_HORIZON_DAYS = 90;
/** The model may not claim certainty, and neither may you. */
export const MIN_PROBABILITY = 0.01;
export const MAX_PROBABILITY = 0.99;
/** A forecast that always says 50% scores this. Lower is better. */
export const COIN_FLIP_BRIER = 0.25;
const DAY_MS = 86_400_000;
const MIN_BASE_RATE_WINDOWS = 10;

export interface SealInput {
  direction: Direction;
  probability: number;
  horizonDays: number;
}

export type SealValidation =
  | { ok: true; value: SealInput }
  | { ok: false; errors: string[] };

export function validateSealInput(input: unknown): SealValidation {
  if (typeof input !== 'object' || input === null)
    return { ok: false, errors: ['Send a direction, a probability and a horizon.'] };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const direction = DIRECTIONS.find((d) => d === raw.direction);
  if (!direction) errors.push('Choose up or down.');
  const probability = raw.probability;
  if (
    typeof probability !== 'number' ||
    !Number.isFinite(probability) ||
    probability < MIN_PROBABILITY ||
    probability > MAX_PROBABILITY
  )
    errors.push(
      `Probability must be between ${MIN_PROBABILITY * 100}% and ${MAX_PROBABILITY * 100}%. Nothing is certain.`,
    );
  const horizon = raw.horizonDays;
  if (
    typeof horizon !== 'number' ||
    !Number.isInteger(horizon) ||
    horizon < MIN_HORIZON_DAYS ||
    horizon > MAX_HORIZON_DAYS
  )
    errors.push(`The horizon must be a whole number of days from ${MIN_HORIZON_DAYS} to ${MAX_HORIZON_DAYS}.`);
  if (errors.length || !direction) return { ok: false, errors };
  return {
    ok: true,
    value: {
      direction,
      probability: probability as number,
      horizonDays: horizon as number,
    },
  };
}

/** The end of the UTC day the horizon falls on. The daily close of that day decides the seal. */
export function resolvesAtFor(sealedAt: Date, horizonDays: number): Date {
  const target = new Date(sealedAt.getTime() + horizonDays * DAY_MS);
  return new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate() + 1),
  );
}

/** Did the stated direction happen? A tie counts as no. */
export function outcomeFor(
  direction: Direction,
  referencePrice: number,
  resolvedPrice: number,
): boolean {
  return direction === 'up' ? resolvedPrice > referencePrice : resolvedPrice < referencePrice;
}

/** Brier score for one forecast: the squared gap between the probability and what happened. 0 is perfect. */
export function brier(probability: number, outcome: boolean): number {
  return (probability - (outcome ? 1 : 0)) ** 2;
}

export interface DailyClose {
  timestamp: string;
  close: number;
}

/**
 * Share of past windows of this many days in which the price moved the stated
 * way, from daily closes. Null with fewer than 10 windows: a base rate from a
 * handful of windows would look more certain than it is.
 */
export function baseRate(
  closes: DailyClose[],
  horizonDays: number,
  direction: Direction,
): number | null {
  const sorted = [...closes]
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const windows = sorted.length - horizonDays;
  if (windows < MIN_BASE_RATE_WINDOWS) return null;
  let hits = 0;
  for (let i = 0; i < windows; i++)
    if (outcomeFor(direction, sorted[i].close, sorted[i + horizonDays].close)) hits++;
  return hits / windows;
}

/**
 * Pick the daily close that decides a seal: the candle for the UTC day before
 * `resolvesAt`, and only once that day has ended. Null when it is not yet
 * final, or not in the candles Bitget returned.
 */
export function resolvingClose(
  closes: DailyClose[],
  resolvesAt: Date,
  now: Date,
): DailyClose | null {
  if (now.getTime() < resolvesAt.getTime()) return null;
  const dayStart = resolvesAt.getTime() - DAY_MS;
  return (
    closes.find((c) => {
      const t = Date.parse(c.timestamp);
      return Number.isFinite(t) && t >= dayStart && t < resolvesAt.getTime();
    }) ?? null
  );
}

export function parseSystemProbability(
  text: string,
): { probability: number; rationale: string } | null {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(stripped.slice(first, last + 1)) as Record<string, unknown>;
    const p = typeof parsed.probability === 'string' ? Number(parsed.probability) : parsed.probability;
    if (typeof p !== 'number' || !Number.isFinite(p)) return null;
    // Accept 62 as 62%, but never guess between 0.5 and 1 versus 50 and 100 for a bare 1.
    const probability = p > 1 ? p / 100 : p;
    if (probability < MIN_PROBABILITY || probability > MAX_PROBABILITY) return null;
    const rationale =
      typeof parsed.rationale === 'string' ? parsed.rationale.trim().slice(0, 400) : '';
    return { probability, rationale };
  } catch {
    return null;
  }
}

export interface ScoredSeal {
  userProbability: number;
  systemProbability: number;
  outcome: boolean;
  userBrier: number;
  systemBrier: number;
  resolvedAt: string;
}

export interface Calibration {
  resolved: number;
  userMeanBrier: number | null;
  systemMeanBrier: number | null;
  /** Who scored lower (better) on average. Null on a tie or with nothing resolved. */
  better: 'you' | 'uncle' | null;
  /** Share of resolved seals in which the stated direction happened. */
  hitRate: number | null;
  /** Mean stated probability, to compare with the hit rate. */
  userMeanProbability: number | null;
  systemMeanProbability: number | null;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function calibration(scored: ScoredSeal[]): Calibration {
  const userMeanBrier = mean(scored.map((s) => s.userBrier));
  const systemMeanBrier = mean(scored.map((s) => s.systemBrier));
  let better: Calibration['better'] = null;
  if (userMeanBrier !== null && systemMeanBrier !== null) {
    if (Math.abs(userMeanBrier - systemMeanBrier) > 1e-9)
      better = userMeanBrier < systemMeanBrier ? 'you' : 'uncle';
  }
  return {
    resolved: scored.length,
    userMeanBrier,
    systemMeanBrier,
    better,
    hitRate: mean(scored.map((s) => (s.outcome ? 1 : 0))),
    userMeanProbability: mean(scored.map((s) => s.userProbability)),
    systemMeanProbability: mean(scored.map((s) => s.systemProbability)),
  };
}
