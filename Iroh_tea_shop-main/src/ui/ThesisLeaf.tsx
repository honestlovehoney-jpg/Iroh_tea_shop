'use client';
import { useId, useState, type ReactNode } from 'react';
import type {
  Section,
  ThesisId,
  Ticker,
  TickerDetail,
  TickerSignal,
} from '../thesis/types';
import {
  formatDay,
  formatPct,
  formatPrice,
  formatRelative,
  formatVolume,
  shopErrorText,
} from './deckModel';
import { SourcedNumber } from './SourcedNumber';

// Reuse a loaded detail for a few minutes, so reopening a stock is instant.
const DETAIL_REUSE_MS = 5 * 60 * 1000;
const detailCache = new Map<
  string,
  { loadedAt: number; pending: Promise<TickerDetail> }
>();

/** An error the shop reported, safe to show as is. */
class DetailError extends Error {}

function loadDetail(thesisId: ThesisId, symbol: string) {
  const key = `${thesisId}/${symbol}`;
  const cached = detailCache.get(key);
  if (cached && Date.now() - cached.loadedAt < DETAIL_REUSE_MS)
    return cached.pending;
  const pending = fetch(
    `/api/theses/${thesisId}/${encodeURIComponent(symbol)}`,
    { cache: 'no-store' },
  ).then(async (response) => {
    if (response.ok) return (await response.json()) as TickerDetail;
    throw new DetailError(await shopErrorText(response));
  });
  detailCache.set(key, { loadedAt: Date.now(), pending });
  pending.catch(() => {
    if (detailCache.get(key)?.pending === pending) detailCache.delete(key);
  });
  return pending;
}

function Figure({
  signal,
  offline,
}: {
  signal: TickerSignal | undefined;
  offline: boolean;
}) {
  if (offline || !signal)
    return (
      <span className="leaf-figure" data-dir="none">
        <span className="leaf-amount">Offline</span>
        <span className="leaf-unit">no Bitget data</span>
      </span>
    );
  if (signal.status !== 'ok' || signal.changePct === null)
    return (
      <span className="leaf-figure" data-dir="none">
        <span className="leaf-amount">
          {signal.status === 'error' ? 'No data' : 'Not listed'}
        </span>
        <span className="leaf-unit">
          {signal.status === 'error'
            ? 'Bitget did not respond'
            : 'no candles for this stock'}
        </span>
      </span>
    );
  const value = signal.changePct;
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span className="leaf-figure" data-dir={dir}>
      <span className="leaf-amount">
        <span className="leaf-glyph" aria-hidden="true">
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'}
        </span>
        {formatPct(value, true)}
      </span>
      <span className="leaf-unit">price change · 7d</span>
    </span>
  );
}

function DetailSection<T>({
  title,
  section,
  children,
}: {
  title: string;
  section: Section<T>;
  children: (data: T) => ReactNode;
}) {
  if (section.status === 'not-applicable') return null;
  return (
    <section className="leaf-section" data-status={section.status}>
      <h5 className="leaf-section-title">{title}</h5>
      {section.status === 'ok' ? (
        children(section.data)
      ) : section.status === 'empty' ? (
        <p className="leaf-quiet">Bitget has no data here.</p>
      ) : (
        <p className="leaf-unavailable">Unavailable · {section.reason}</p>
      )}
    </section>
  );
}

function Detail({ detail, now }: { detail: TickerDetail; now: number }) {
  return (
    <>
      <p className="leaf-live">
        <span className="leaf-live-dot" aria-hidden="true" />
        Bitget data · fetched {formatRelative(detail.fetchedAt, now)}
        {detail.stale && <span className="deck-stale">Stale</span>}
      </p>
      <div className="leaf-sections">
        <DetailSection title="Daily candles" section={detail.candles}>
          {({ rows, changePct, high, low }) => (
            <>
              <p className="leaf-stat">
                <strong>
                  <SourcedNumber source={detail.candlesRef} kind="window_change" label={`${detail.symbol} change over the window`}>
                    {formatPct(changePct, true)}
                  </SourcedNumber>
                </strong>{' '}
                over {rows.length} days · range{' '}
                <SourcedNumber source={detail.candlesRef} kind="range" label={`${detail.symbol} low`}>
                  {formatPrice(low)}
                </SourcedNumber>{' '}
                to{' '}
                <SourcedNumber source={detail.candlesRef} kind="range" label={`${detail.symbol} high`}>
                  {formatPrice(high)}
                </SourcedNumber>
              </p>
              <ul className="leaf-list">
                {[...rows].reverse().map((row) => (
                  <li key={row.date}>
                    <span className="leaf-who">{formatDay(row.date)}</span>
                    <span className="leaf-money">
                      <SourcedNumber source={detail.candlesRef} kind="candle" label={`${formatDay(row.date)} open`}>
                        {formatPrice(row.open)}
                      </SourcedNumber>{' '}
                      →{' '}
                      <SourcedNumber source={detail.candlesRef} kind="candle" label={`${formatDay(row.date)} close`}>
                        {formatPrice(row.close)}
                      </SourcedNumber>
                    </span>
                    <span
                      className={row.close >= row.open ? 'leaf-pos' : 'leaf-neg'}
                    >
                      <SourcedNumber source={detail.candlesRef} kind="candle_move" label={`${formatDay(row.date)} move`}>
                        {formatPct(
                          row.open === 0
                            ? null
                            : ((row.close - row.open) / row.open) * 100,
                          true,
                        )}
                      </SourcedNumber>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DetailSection>

        <DetailSection title="Live quote" section={detail.quote}>
          {(quote) => (
            <ul className="leaf-list">
              <li>
                <span className="leaf-who">Last price</span>
                <span className="leaf-money"><SourcedNumber source={detail.quoteRef} kind="quote" label="quote lastPrice">{formatPrice(quote.lastPrice)}</SourcedNumber></span>
              </li>
              <li>
                <span className="leaf-who">Open</span>
                <span className="leaf-money"><SourcedNumber source={detail.quoteRef} kind="quote" label="quote open">{formatPrice(quote.open)}</SourcedNumber></span>
              </li>
              <li>
                <span className="leaf-who">High</span>
                <span className="leaf-pos"><SourcedNumber source={detail.quoteRef} kind="quote" label="quote high">{formatPrice(quote.high)}</SourcedNumber></span>
              </li>
              <li>
                <span className="leaf-who">Low</span>
                <span className="leaf-neg"><SourcedNumber source={detail.quoteRef} kind="quote" label="quote low">{formatPrice(quote.low)}</SourcedNumber></span>
              </li>
              <li>
                <span className="leaf-who">Volume</span>
                <span className="leaf-money"><SourcedNumber source={detail.quoteRef} kind="quote" label="quote volume">{formatVolume(quote.volume)}</SourcedNumber></span>
              </li>
            </ul>
          )}
        </DetailSection>
      </div>
      <p className="leaf-quiet">
        Tap any underlined number to see its source and time. Sources: Bitget candles
        {detail.instrumentId ? ` for ${detail.instrumentId}` : ''} and Bitget
        MCP equity_price_quote. Read-only research, not advice.
      </p>
    </>
  );
}

type DetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; detail: TickerDetail }
  | { status: 'error'; reason: string };

export function ThesisLeaf({
  thesisId,
  ticker,
  signal,
  offline,
  now,
}: {
  thesisId: ThesisId;
  ticker: Ticker;
  signal: TickerSignal | undefined;
  offline: boolean;
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<DetailState>({ status: 'idle' });
  const panelId = useId();

  const fetchDetail = () => {
    setState({ status: 'loading' });
    loadDetail(thesisId, ticker.symbol).then(
      (detail) => setState({ status: 'ok', detail }),
      (error: unknown) =>
        setState({
          status: 'error',
          // Never show raw text such as 'Failed to fetch' or a JSON SyntaxError.
          reason:
            error instanceof DetailError
              ? error.message
              : 'Bitget data is unavailable right now.',
        }),
    );
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && (state.status === 'idle' || state.status === 'error'))
      fetchDetail();
  };

  return (
    <li className="leaf" data-expanded={expanded ? 'true' : 'false'}>
      <h4 className="leaf-heading">
        <button
          type="button"
          className="leaf-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={toggle}
        >
          <span className="leaf-symbol">{ticker.symbol}</span>
          <span className="leaf-name">
            {ticker.name}
            <span className="leaf-class">Stock</span>
          </span>
          <Figure signal={signal} offline={offline} />
          <span className="leaf-chevron" aria-hidden="true" />
        </button>
      </h4>
      <div id={panelId} className="leaf-detail" hidden={!expanded}>
        {state.status === 'loading' || state.status === 'idle' ? (
          <div className="leaf-loading" role="status">
            <span className="plaque-shimmer" />
            <span className="plaque-shimmer plaque-shimmer--short" />
            <span className="sr-only">
              Loading Bitget data for {ticker.symbol}…
            </span>
          </div>
        ) : state.status === 'error' ? (
          <p className="leaf-unavailable" role="status">
            Unavailable · {state.reason}{' '}
            <button type="button" className="leaf-retry" onClick={fetchDetail}>
              Try again
            </button>
          </p>
        ) : (
          <Detail detail={state.detail} now={now} />
        )}
      </div>
    </li>
  );
}
