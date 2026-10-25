'use client';
import { useEffect, useState } from 'react';
import type { MarketBoard as MarketBoardData, MarketRow } from '../thesis/types';
import {
  formatPct,
  formatPrice,
  formatRelative,
  shopErrorText,
} from './deckModel';
import { SourcedNumber } from './SourcedNumber';
import './styles/bitget.css';
import './styles/panels.css';

type State =
  | { status: 'loading' }
  | { status: 'error'; reason: string }
  | { status: 'ready'; board: MarketBoardData };

const dir = (value: number | null) =>
  value === null ? 'none' : value > 0 ? 'up' : value < 0 ? 'down' : 'flat';

function Spark({ closes, tone }: { closes: number[]; tone: string }) {
  if (closes.length < 2) return <span className="mkt-spark" aria-hidden="true" />;
  const min = Math.min(...closes);
  const span = Math.max(...closes) - min || 1;
  const points = closes
    .map((close, i) => {
      const x = (i / (closes.length - 1)) * 100;
      const y = 100 - ((close - min) / span) * 100;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className="mkt-spark"
      data-dir={tone}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={points} />
    </svg>
  );
}

function Row({ row }: { row: MarketRow }) {
  if (row.status !== 'ok')
    return (
      <li className="mkt-row" data-state="missing">
        <span className="mkt-symbol">{row.symbol}</span>
        <span className="mkt-name">{row.name}</span>
        <span className="mkt-missing srclock-withheld">
          Withheld:{' '}
          {row.status === 'error' ? 'Bitget did not respond' : 'not in the catalog'}
        </span>
      </li>
    );
  const tone = dir(row.dayChangePct ?? row.weekChangePct);
  return (
    <li className="mkt-row">
      <span className="mkt-symbol">{row.symbol}</span>
      <span className="mkt-name">{row.name}</span>
      <Spark closes={row.closes} tone={dir(row.weekChangePct)} />
      <span className="mkt-price">
        <SourcedNumber source={row.ref} kind="close" label={`${row.symbol} last close`}>
          {formatPrice(row.lastClose)}
        </SourcedNumber>
      </span>
      <span className="mkt-move" data-dir={tone}>
        <span className="mkt-glyph" aria-hidden="true">
          {tone === 'up' ? '▲' : tone === 'down' ? '▼' : '•'}
        </span>
        <SourcedNumber source={row.ref} kind="day_change" label={`${row.symbol} one day change`}>
          {formatPct(row.dayChangePct, true)}
        </SourcedNumber>
        <small>1D</small>
      </span>
      <span className="mkt-move mkt-move--week" data-dir={dir(row.weekChangePct)}>
        <SourcedNumber source={row.ref} kind="window_change" label={`${row.symbol} seven day change`}>
          {formatPct(row.weekChangePct, true)}
        </SourcedNumber>
        <small>7D</small>
      </span>
    </li>
  );
}

/**
 * Observatorium station: how the benchmark and the largest US stocks are
 * moving, from Bitget daily candles.
 */
export function MarketBoard({ modelUrl }: { modelUrl: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch('/api/bitget/market', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          return setState({
            status: 'error',
            reason: await shopErrorText(response),
          });
        setState({
          status: 'ready',
          board: (await response.json()) as MarketBoardData,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            reason: 'Bitget data is unavailable right now.',
          });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section className="mkt-panel" aria-label="Major stocks market board">
      <header className="mkt-head">
        <p className="eyebrow">Observatorium · Bitget Reality</p>
        <h2 className="mkt-title">Major stocks</h2>
        <p className="mkt-lede">
          The S&amp;P 500 benchmark and the largest US names, from Bitget
          daily candles. The last candle is today so far.
        </p>
      </header>

      {state.status === 'loading' && (
        <p className="mkt-note" role="status">
          Charting the stars…
        </p>
      )}

      {state.status === 'error' && (
        <p className="mkt-note mkt-note--error" role="status">
          {state.reason}{' '}
          <button
            type="button"
            className="leaf-retry"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Try again
          </button>
        </p>
      )}

      {state.status === 'ready' && (
        <>
          {state.board.ref?.marketClosed && (
            <p className="srclock-banner" role="note">
              The US market is closed. These token prices can be thin or stale
              until it reopens. Tap any number to see its source.
            </p>
          )}
          <dl className="mkt-stats">
            <div>
              <dt>Rising today</dt>
              <dd>
                <SourcedNumber source={state.board.ref} kind="count" label="stocks rising today">
                  {state.board.summary.risingToday}
                </SourcedNumber>
                <small> of {state.board.summary.dayMeasured}</small>
              </dd>
            </div>
            <div>
              <dt>Average today</dt>
              <dd data-dir={dir(state.board.summary.avgDayPct)}>
                <SourcedNumber source={state.board.ref} kind="average" label="average move today">
                  {formatPct(state.board.summary.avgDayPct, true)}
                </SourcedNumber>
              </dd>
            </div>
            <div>
              <dt>Average 7 days</dt>
              <dd data-dir={dir(state.board.summary.avgWeekPct)}>
                <SourcedNumber source={state.board.ref} kind="average" label="average move over seven days">
                  {formatPct(state.board.summary.avgWeekPct, true)}
                </SourcedNumber>
              </dd>
            </div>
            {state.board.summary.leader && state.board.summary.laggard && (
              <div>
                <dt>Leader · laggard</dt>
                <dd className="mkt-extremes">
                  <span data-dir="up">
                    {state.board.summary.leader.symbol}{' '}
                    <SourcedNumber
                      source={state.board.rows.find((r) => r.symbol === state.board.summary.leader?.symbol)?.ref}
                      kind="day_change"
                      label="leader one day change"
                    >
                      {formatPct(state.board.summary.leader.dayChangePct, true)}
                    </SourcedNumber>
                  </span>
                  <span data-dir="down">
                    {state.board.summary.laggard.symbol}{' '}
                    <SourcedNumber
                      source={state.board.rows.find((r) => r.symbol === state.board.summary.laggard?.symbol)?.ref}
                      kind="day_change"
                      label="laggard one day change"
                    >
                      {formatPct(state.board.summary.laggard.dayChangePct, true)}
                    </SourcedNumber>
                  </span>
                </dd>
              </div>
            )}
          </dl>

          <ul className="mkt-list" aria-label="Prices and moves">
            {state.board.rows.map((row) => (
              <Row key={row.symbol} row={row} />
            ))}
          </ul>

          <p className="mkt-note">
            Bitget data · fetched {formatRelative(state.board.fetchedAt, now)}.
            Read-only research, not advice.
          </p>
        </>
      )}

      <p className="mkt-model">
        <a href={modelUrl} target="_blank" rel="noopener noreferrer">
          Open the planetary model <span aria-hidden="true">↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </section>
  );
}
