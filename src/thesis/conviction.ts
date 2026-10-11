import type { Conviction, TickerSignal } from './types';

/**
 * Momentum breadth: the share of measured stocks that rose over the window.
 * 75% or more reads Strong, 50% or more Building, anything less Weak.
 */
export function computeConviction(signals: TickerSignal[]): Conviction {
  const measuredSignals = signals.filter(
    (signal) =>
      signal.status === 'ok' &&
      typeof signal.changePct === 'number' &&
      Number.isFinite(signal.changePct),
  );
  const measured = measuredSignals.length;
  const rising = measuredSignals.filter(
    (signal) => (signal.changePct as number) > 0,
  ).length;
  const avgChangePct =
    measured === 0
      ? null
      : measuredSignals.reduce(
          (sum, signal) => sum + (signal.changePct as number),
          0,
        ) / measured;
  const ratio = measured === 0 ? 0 : rising / measured;
  const level =
    measured === 0
      ? 'unknown'
      : ratio >= 0.75
        ? 'strong'
        : ratio >= 0.5
          ? 'steeping'
          : 'weak';
  return { level, rising, measured, avgChangePct };
}
