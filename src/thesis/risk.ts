// The Balance Scale: portfolio risk checks before a thesis is served (locked).
// Pure functions with no imports. The thresholds are fixed and listed here so
// the page, the server and the tests all use the same ones.

export const THRESHOLDS = {
  /** Share of the portfolio in one stock after adding this position. */
  concentration: { warn: 0.1, block: 0.25 },
  /** Value-weighted average correlation with holdings measured on Bitget, when they are a real share of the portfolio. */
  correlation: { warn: 0.7, block: 0.9, minWeight: 0.2, blockMinWeight: 0.4 },
  /** Loss from the worst 3-day move on record, as a share of the portfolio. */
  gap: { warn: 0.03, block: 0.08 },
  /** Margin used after adding this position, as a share of collateral. */
  margin: { warn: 0.6, block: 0.9 },
} as const;

const MIN_CORRELATION_RETURNS = 20;
const MIN_GAP_CANDLES = 30;
const GAP_DAYS = 3;
export const MAX_HOLDINGS = 20;
export const MAX_LEVERAGE = 20;

export interface Holding {
  symbol: string;
  valueUsd: number;
}
export interface Portfolio {
  totalUsd: number;
  collateralUsd: number | null;
  marginUsedUsd: number | null;
  holdings: Holding[];
}

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const money = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;

export function validatePortfolio(input: unknown): Validation<Portfolio> {
  if (typeof input !== 'object' || input === null)
    return { ok: false, errors: ['Send your portfolio.'] };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  if (!money(raw.totalUsd) || raw.totalUsd <= 0)
    errors.push('Total portfolio value must be a number above 0.');
  const optional = (value: unknown, name: string): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (!money(value)) {
      errors.push(`${name} must be a number of 0 or more.`);
      return null;
    }
    return value;
  };
  const collateralUsd = optional(raw.collateralUsd, 'Collateral');
  const marginUsedUsd = optional(raw.marginUsedUsd, 'Margin used');
  if (marginUsedUsd !== null && collateralUsd === null)
    errors.push('Margin used needs the collateral it is measured against.');
  if (
    collateralUsd !== null &&
    marginUsedUsd !== null &&
    marginUsedUsd > collateralUsd
  )
    errors.push('Margin used cannot be more than the collateral.');

  const holdings: Holding[] = [];
  if (raw.holdings !== undefined && !Array.isArray(raw.holdings))
    errors.push('Holdings must be a list.');
  else if (Array.isArray(raw.holdings)) {
    if (raw.holdings.length > MAX_HOLDINGS)
      errors.push(`You can list up to ${MAX_HOLDINGS} holdings.`);
    for (const item of raw.holdings.slice(0, MAX_HOLDINGS)) {
      const h = item as Record<string, unknown>;
      const symbol =
        typeof h?.symbol === 'string' ? h.symbol.trim().toUpperCase() : '';
      if (
        !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol) ||
        !money(h?.valueUsd) ||
        h.valueUsd <= 0
      ) {
        errors.push('Each holding needs a symbol and a value above 0.');
        break;
      }
      const existing = holdings.find((x) => x.symbol === symbol);
      if (existing) existing.valueUsd += h.valueUsd as number;
      else holdings.push({ symbol, valueUsd: h.valueUsd as number });
    }
  }
  const held = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
  if (money(raw.totalUsd) && held > raw.totalUsd * 1.0000001)
    errors.push('Your holdings add up to more than the total portfolio value.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      totalUsd: raw.totalUsd as number,
      collateralUsd,
      marginUsedUsd,
      holdings,
    },
  };
}

export interface PositionInput {
  plannedUsd: number;
  leverage: number;
}

export function validatePosition(input: unknown): Validation<PositionInput> {
  if (typeof input !== 'object' || input === null)
    return { ok: false, errors: ['Send the size of the position.'] };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  if (!money(raw.plannedUsd) || raw.plannedUsd <= 0)
    errors.push('Position size must be a number above 0.');
  const leverage =
    raw.leverage === undefined || raw.leverage === null ? 1 : raw.leverage;
  if (
    typeof leverage !== 'number' ||
    !Number.isFinite(leverage) ||
    leverage < 1 ||
    leverage > MAX_LEVERAGE
  )
    errors.push(`Leverage must be from 1 to ${MAX_LEVERAGE}.`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      plannedUsd: raw.plannedUsd as number,
      leverage: leverage as number,
    },
  };
}

export interface Close {
  timestamp: string;
  close: number;
}

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Daily returns keyed by the day they end on. */
export function dailyReturns(closes: Close[]): Map<string, number> {
  const sorted = [...closes]
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++)
    out.set(
      dayKey(sorted[i].timestamp),
      sorted[i].close / sorted[i - 1].close - 1,
    );
  return out;
}

/** Pearson correlation of two return series over the days they share. Null with too few shared days or no variation. */
export function correlation(a: Close[], b: Close[]): number | null {
  const ra = dailyReturns(a);
  const rb = dailyReturns(b);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [day, x] of ra) {
    const y = rb.get(day);
    if (y !== undefined) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < MIN_CORRELATION_RETURNS) return null;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** The worst return over any run of `days` daily closes. Negative number, or null with too little history. */
export function worstWindow(closes: Close[], days: number): number | null {
  const sorted = [...closes]
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (sorted.length < MIN_GAP_CANDLES) return null;
  let worst = 0;
  for (let i = days; i < sorted.length; i++)
    worst = Math.min(worst, sorted[i].close / sorted[i - days].close - 1);
  return worst;
}

export type RiskLevel = 'ok' | 'warn' | 'block' | 'unmeasured';
export type MetricKey = 'concentration' | 'correlation' | 'gap' | 'margin';

export interface RiskMetric {
  key: MetricKey;
  label: string;
  level: RiskLevel;
  /** The number behind the level, as a fraction (0.12 is 12%). Null when unmeasured. */
  value: number | null;
  /** One plain sentence. */
  message: string;
}

export interface RiskInput {
  portfolio: Portfolio;
  position: PositionInput;
  symbol: string;
  /** Daily closes of the thesis stock, or null when Bitget returned none. */
  closes: Close[] | null;
  /** Daily closes of each holding that Bitget lists, keyed by symbol. A missing key means not listed. */
  holdingCloses: Map<string, Close[] | null>;
  /** Is the US cash market shut right now? */
  marketClosed: boolean;
}

export interface RiskReport {
  metrics: RiskMetric[];
  /** clear: nothing breached. warn: soft limits breached. block: a hard limit breached. */
  verdict: 'clear' | 'warn' | 'block';
  /** Metrics that must be acknowledged before locking. */
  needsAck: MetricKey[];
  hasBlock: boolean;
}

const pct = (f: number, digits = 1) => `${(f * 100).toFixed(digits)}%`;
const level = (value: number, t: { warn: number; block: number }): RiskLevel =>
  value >= t.block ? 'block' : value >= t.warn ? 'warn' : 'ok';

export function computeRisk(input: RiskInput): RiskReport {
  const { portfolio, position, symbol } = input;
  const metrics: RiskMetric[] = [];
  const total = portfolio.totalUsd;

  // 1. Concentration
  const same = portfolio.holdings
    .filter((h) => h.symbol === symbol.toUpperCase())
    .reduce((s, h) => s + h.valueUsd, 0);
  const share = (same + position.plannedUsd) / total;
  metrics.push({
    key: 'concentration',
    label: 'Concentration',
    level: level(share, THRESHOLDS.concentration),
    value: share,
    message: `${symbol} would be ${pct(share)} of your portfolio${same > 0 ? ' counting what you already hold' : ''}. Warn at ${pct(THRESHOLDS.concentration.warn, 0)}, block at ${pct(THRESHOLDS.concentration.block, 0)}.`,
  });

  // 2. Correlation with what you hold
  const others = portfolio.holdings.filter(
    (h) => h.symbol !== symbol.toUpperCase(),
  );
  let weighted = 0;
  let measuredWeight = 0;
  const unmeasured: string[] = [];
  if (input.closes) {
    for (const h of others) {
      const c = input.holdingCloses.get(h.symbol);
      const r = c ? correlation(input.closes, c) : null;
      if (r === null) unmeasured.push(h.symbol);
      else {
        weighted += r * h.valueUsd;
        measuredWeight += h.valueUsd;
      }
    }
  } else others.forEach((h) => unmeasured.push(h.symbol));
  if (others.length === 0)
    metrics.push({
      key: 'correlation',
      label: 'Correlation',
      level: 'ok',
      value: null,
      message:
        'You hold nothing else, so there is nothing for it to move with.',
    });
  else if (measuredWeight === 0)
    metrics.push({
      key: 'correlation',
      label: 'Correlation',
      level: 'unmeasured',
      value: null,
      message: `Not measured: Bitget has no usable history for ${unmeasured.join(', ')}.`,
    });
  else {
    const avg = weighted / measuredWeight;
    const weightShare = measuredWeight / total;
    let lv: RiskLevel = 'ok';
    if (
      avg >= THRESHOLDS.correlation.block &&
      weightShare >= THRESHOLDS.correlation.blockMinWeight
    )
      lv = 'block';
    else if (
      avg >= THRESHOLDS.correlation.warn &&
      weightShare >= THRESHOLDS.correlation.minWeight
    )
      lv = 'warn';
    metrics.push({
      key: 'correlation',
      label: 'Correlation',
      level: lv,
      value: avg,
      message: `Average daily-return correlation ${avg.toFixed(2)} with holdings worth ${pct(weightShare, 0)} of your portfolio.${unmeasured.length ? ` Not measured: ${unmeasured.join(', ')}.` : ''}`,
    });
  }

  // 3. Weekend and overnight gap risk, from the worst 3-day move on record
  const worst = input.closes ? worstWindow(input.closes, GAP_DAYS) : null;
  if (worst === null)
    metrics.push({
      key: 'gap',
      label: 'Weekend and overnight gap',
      level: 'unmeasured',
      value: null,
      message: `Not measured: fewer than ${MIN_GAP_CANDLES} daily candles from Bitget.`,
    });
  else {
    const loss = (position.plannedUsd * Math.abs(worst)) / total;
    metrics.push({
      key: 'gap',
      label: 'Weekend and overnight gap',
      level: level(loss, THRESHOLDS.gap),
      value: loss,
      message: `The worst 3-day move on record was ${pct(worst)}. On this size that is ${pct(loss)} of your portfolio.${input.marketClosed ? ' The US market is closed now, so token prices can jump when it reopens.' : ''} Past moves do not cap future ones.`,
    });
  }

  // 4. Margin and funding
  const marginNeeded = position.plannedUsd / position.leverage;
  if (portfolio.collateralUsd !== null && portfolio.collateralUsd > 0) {
    const used = (portfolio.marginUsedUsd ?? 0) + marginNeeded;
    const util = used / portfolio.collateralUsd;
    metrics.push({
      key: 'margin',
      label: 'Collateral and margin',
      level: level(util, THRESHOLDS.margin),
      value: util,
      message: `Margin used would be ${pct(util)} of your collateral at ${position.leverage}x.`,
    });
  } else {
    const cash = total - portfolio.holdings.reduce((s, h) => s + h.valueUsd, 0);
    const util = marginNeeded / Math.max(cash, 1e-9);
    metrics.push({
      key: 'margin',
      label: 'Funding',
      level:
        cash <= 0 || marginNeeded > cash
          ? 'block'
          : level(util, THRESHOLDS.margin),
      value: cash <= 0 ? null : util,
      message:
        cash <= 0
          ? 'You have no free cash for this position.'
          : `This position needs ${pct(util)} of your free cash.${marginNeeded > cash ? ' That is more than you have.' : ''}`,
    });
  }

  const needsAck = metrics
    .filter((m) => m.level === 'warn' || m.level === 'block')
    .map((m) => m.key);
  const hasBlock = metrics.some((m) => m.level === 'block');
  return {
    metrics,
    verdict: hasBlock ? 'block' : needsAck.length ? 'warn' : 'clear',
    needsAck,
    hasBlock,
  };
}

export const MIN_OVERRIDE_REASON = 20;

export interface LockRequest {
  acknowledged: MetricKey[];
  overrideReason: string;
}

export type LockDecision =
  | {
      ok: true;
      verdict: 'clear' | 'warn' | 'override';
      overrideReason: string | null;
    }
  | { ok: false; errors: string[] };

/**
 * May this thesis be locked? Every warned or blocked metric must be
 * acknowledged by name. A hard block also needs a reason, which is kept.
 */
export function decideLock(
  report: RiskReport,
  request: LockRequest,
): LockDecision {
  const errors: string[] = [];
  const missing = report.needsAck.filter(
    (k) => !request.acknowledged.includes(k),
  );
  if (missing.length)
    errors.push(`Acknowledge the risk on: ${missing.join(', ')}.`);
  const reason = request.overrideReason.trim();
  if (report.hasBlock && reason.length < MIN_OVERRIDE_REASON)
    errors.push(
      `A hard limit is breached. To go ahead, explain why in at least ${MIN_OVERRIDE_REASON} characters.`,
    );
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    verdict: report.hasBlock
      ? 'override'
      : report.verdict === 'warn'
        ? 'warn'
        : 'clear',
    overrideReason: report.hasBlock ? reason : null,
  };
}
