import { describe, expect, it } from 'vitest';
import { loadThesisContext } from '@/chat/thesis-context';
import type { DeckSnapshot } from '@/thesis/types';

const snapshot = (level: 'strong' | 'unknown'): DeckSnapshot => ({
  fetchedAt: '2026-10-24T00:00:00Z',
  expiresAt: '2026-10-24T00:01:00Z',
  source: 'bitget',
  stale: false,
  theses: [
    {
      id: 'bullrun',
      conviction: { level, rising: 3, measured: 4, avgChangePct: 2.345 },
      tickers: [],
    },
  ],
});

describe('thesis context for Uncle', () => {
  it('ignores missing or unknown thesis ids', async () => {
    const load = async () => snapshot('strong');
    expect(await loadThesisContext(undefined, load)).toBeNull();
    expect(await loadThesisContext('nope', load)).toBeNull();
    expect(await loadThesisContext({ id: 'bullrun' }, load)).toBeNull();
  });

  it('builds a block from the server copy of the thesis and its momentum', async () => {
    const ctx = await loadThesisContext('bullrun', async () =>
      snapshot('strong'),
    );
    expect(ctx?.thesis.tickers.map((t) => t.symbol)).toContain('TSLA');
    expect(ctx?.block).toContain('Growth & Consumer');
    expect(ctx?.block).toContain('strong, 3 of 4 stocks rose');
    expect(ctx?.block).toContain('2.35 percent');
    expect(ctx?.block).toContain('does not say the thesis is right');
  });

  it('still returns the thesis when the momentum reading fails', async () => {
    const ctx = await loadThesisContext('bullrun', async () => {
      throw new Error('db down');
    });
    expect(ctx?.block).toContain('not available right now');
    expect(ctx?.block).toContain('Growth & Consumer');
  });

  it('treats an unknown reading as unavailable', async () => {
    const ctx = await loadThesisContext('bullrun', async () =>
      snapshot('unknown'),
    );
    expect(ctx?.block).toContain('not available right now');
  });
});
