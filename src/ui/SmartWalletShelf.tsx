'use client';
import { useEffect, useState } from 'react';
import { formatRelative, shopErrorText } from './deckModel';
import './styles/bitget.css';

interface Coverage {
  catalogSize: number;
  coveredCount: number;
  unverifiedCount: number;
  coveragePercentage: number;
  countsByStatus: Record<string, number>;
  sample: {
    instrumentId: string;
    status: string;
    lastAttemptedAt: string;
    lastSucceededAt: string | null;
  }[];
}

type State =
  | { status: 'loading' }
  | { status: 'error'; reason: string }
  | { status: 'ready'; coverage: Coverage };

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  stale: 'Stale',
  unavailable: 'Unavailable',
  unsupported: 'Unsupported',
  error: 'Error',
};

/**
 * Shelf station: how much of the Bitget Reality stock catalog has verified
 * price-candle data. No wallets and no leaderboards.
 */
export function SmartWalletShelf(_props: { research?: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch('/api/bitget/coverage?pageSize=8', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          return setState({
            status: 'error',
            reason: await shopErrorText(response),
          });
        setState({
          status: 'ready',
          coverage: (await response.json()) as Coverage,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            reason: 'Coverage statistics are unavailable right now.',
          });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="parchment-hanger">
      <span className="parchment-rod" aria-hidden="true" />
      <div className="leaderboard-parchment">
        <section className="cov-panel" aria-label="Research coverage shelf">
          <header className="cov-head">
            <p className="eyebrow">Shelf · Bitget Reality</p>
            <h2 className="cov-title">Market coverage</h2>
            <p className="cov-lede">
              How many tokenized US stocks the shop tracks, and how many have
              verified daily price candles.
            </p>
          </header>

          {state.status === 'loading' && (
            <p className="cov-note" role="status">
              Counting the shelf…
            </p>
          )}

          {state.status === 'error' && (
            <p className="cov-note cov-note--error" role="status">
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
              <dl className="cov-stats">
                <div>
                  <dt>In the catalog</dt>
                  <dd>{state.coverage.catalogSize.toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt>With candle checks</dt>
                  <dd>{state.coverage.coveredCount.toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt>Not checked yet</dt>
                  <dd>{state.coverage.unverifiedCount.toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>{state.coverage.coveragePercentage}%</dd>
                </div>
              </dl>
              <div
                className="cov-bar"
                role="img"
                aria-label={`${state.coverage.coveragePercentage}% of the catalog has been checked`}
              >
                <span
                  style={{
                    width: `${Math.min(100, Math.max(0, state.coverage.coveragePercentage))}%`,
                  }}
                />
              </div>
              <ul className="cov-chips" aria-label="Checks by result">
                {Object.entries(state.coverage.countsByStatus)
                  .filter(([, count]) => count > 0)
                  .map(([status, count]) => (
                    <li key={status} data-status={status}>
                      {STATUS_LABEL[status] ?? status}
                      <strong>{count}</strong>
                    </li>
                  ))}
              </ul>
              {state.coverage.sample.length > 0 && (
                <>
                  <h3 className="cov-sub">Latest checks</h3>
                  <ul className="cov-list">
                    {state.coverage.sample.map((row) => (
                      <li key={row.instrumentId}>
                        <span className="cov-id">{row.instrumentId}</span>
                        <span className="cov-status" data-status={row.status}>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                        <span className="cov-time">
                          {formatRelative(row.lastAttemptedAt, now)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="cov-note">
                Open the <strong>Counter</strong> to read the theses, or ask the{' '}
                <strong>Host</strong> about a stock.
              </p>
            </>
          )}
        </section>
      </div>
      <span className="parchment-rod parchment-rod-bottom" aria-hidden="true" />
    </div>
  );
}
