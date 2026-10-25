import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../src/auth/db', async () => {
  const { createFakeDb } = await import('./fake-thesis-db');
  return { db: createFakeDb() };
});

import { db as rawDb } from '../src/auth/db';
import type { FakeDb } from './fake-thesis-db';
import * as list from '../src/app/api/saved-theses/route';
import * as one from '../src/app/api/saved-theses/[thesisId]/route';
import * as paths from '../src/app/api/saved-theses/[thesisId]/failure-paths/route';
import * as generate from '../src/app/api/saved-theses/[thesisId]/failure-paths/generate/route';
import * as pathOne from '../src/app/api/saved-theses/[thesisId]/failure-paths/[pathId]/route';
import * as advance from '../src/app/api/saved-theses/[thesisId]/advance/route';
import * as evidence from '../src/app/api/saved-theses/[thesisId]/evidence/route';
import * as evidenceRefresh from '../src/app/api/saved-theses/[thesisId]/evidence/refresh/route';
import * as evidenceOne from '../src/app/api/saved-theses/[thesisId]/evidence/[claimId]/route';
import * as seal from '../src/app/api/saved-theses/[thesisId]/seal/route';
import * as calibrationRoute from '../src/app/api/saved-theses/calibration/route';
import { resolveDueSeals } from '../src/thesis/resolve';
import { resetGenerationLog } from '../src/thesis/store';
import * as portfolioRoute from '../src/app/api/portfolio/route';
import * as riskRoute from '../src/app/api/saved-theses/[thesisId]/risk/route';
import * as lockRoute from '../src/app/api/saved-theses/[thesisId]/lock/route';
import * as watch from '../src/app/api/saved-theses/watch/route';

const db = rawDb as unknown as FakeDb;
const resetAll = () => {
  db.__reset();
  resetGenerationLog();
};
const GUEST_A = '11111111-1111-4111-8111-111111111111';
const GUEST_B = '22222222-2222-4222-8222-222222222222';
const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const req = (
  method: string,
  guest: string | null,
  body?: unknown,
  path = '/api/saved-theses',
) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(guest ? { cookie: `iroh_guest=${guest}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (thesisId: string, pathId = '') => ({
  params: Promise.resolve({ thesisId, pathId }),
});

const claimCtx = (thesisId: string, claimId: string) => ({
  params: Promise.resolve({ thesisId, claimId }),
});

const goodPath = (extra: Record<string, unknown> = {}) => ({
  condition: 'Revenue growth falls below 5% in the next two quarterly reports.',
  probability: 0.25,
  impactPct: 7,
  deadline: future(120),
  triggerKind: 'date',
  triggerLevel: null,
  triggerNote: 'Check the next two earnings releases',
  ...extra,
});

async function newThesis(guest: string, extra: Record<string, unknown> = {}) {
  const response = await list.POST(
    req('POST', guest, {
      title: 'Mega-cap tokenization',
      content: 'Large US stocks keep deep tokenized liquidity on Bitget.',
      ...extra,
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).thesis as { id: string };
}

async function addOwnPaths(guest: string, id: string, count: number) {
  for (let i = 0; i < count; i++) {
    const response = await paths.POST(
      req('POST', guest, goodPath(), `/api/saved-theses/${id}/failure-paths`),
      ctx(id),
    );
    expect(response.status).toBe(201);
  }
}

const unclePaths = (n: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    paths: Array.from({ length: n }, (_, i) => ({
      condition: `Failure mode ${i + 1}: revenue misses guidance by more than 10% before the deadline.`,
      probability: 0.1 + i / 20,
      impactPct: 5 + i,
      deadline: future(90),
      trigger: { kind: 'date', level: null, note: 'Watch the earnings release' },
      ...extra,
    })),
  });

function stubQwen(content: string) {
  process.env.QWEN_BASE_URL = 'http://qwen.test';
  process.env.QWEN_API_KEY = 'test';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
    })) as typeof fetch;
}

describe('owner scoping', () => {
  it('gives a first-time guest a cookie and keeps theses private to their owner', async () => {
    resetAll();
    const first = await list.POST(
      req('POST', null, {
        title: 'My thesis',
        content: 'A thesis that is long enough to be a real statement.',
      }),
    );
    expect(first.status).toBe(201);
    expect(first.headers.get('set-cookie') ?? '').toContain('iroh_guest=');

    const mine = await newThesis(GUEST_A);
    const others = await (await list.GET(req('GET', GUEST_B))).json();
    expect(others.theses).toHaveLength(0);
    expect((await one.GET(req('GET', GUEST_B), ctx(mine.id))).status).toBe(404);
    expect((await one.GET(req('GET', GUEST_A), ctx(mine.id))).status).toBe(200);
    expect((await one.DELETE(req('DELETE', GUEST_B), ctx(mine.id))).status).toBe(404);
    const ownList = await (await list.GET(req('GET', GUEST_A))).json();
    expect(ownList.theses).toHaveLength(1);
  });

  it('rejects a thesis with no real statement and a cross-site post', async () => {
    resetAll();
    const short = await list.POST(req('POST', GUEST_A, { title: 'Hi', content: 'short' }));
    expect(short.status).toBe(400);
    const cross = await list.POST(
      new Request('http://localhost/api/saved-theses', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(cross.status).toBe(403);
  });
});

describe('the Failure Table gate', () => {
  it('cannot be signed off with no paths, or by skipping stages', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    const url = `/api/saved-theses/${t.id}/advance`;
    const empty = await advance.POST(req('POST', GUEST_A, { to: 'failures_resolved' }, url), ctx(t.id));
    expect(empty.status).toBe(409);
    expect((await empty.json()).code).toBe('blocked');
    const skip = await advance.POST(req('POST', GUEST_A, { to: 'locked' }, url), ctx(t.id));
    expect(skip.status).toBe(409);
    expect((await skip.json()).code).toBe('out_of_order');
  });

  it('opens once three paths are decided, then freezes the table', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    await addOwnPaths(GUEST_A, t.id, 3);
    const url = `/api/saved-theses/${t.id}/advance`;
    const ok = await advance.POST(req('POST', GUEST_A, { to: 'failures_resolved' }, url), ctx(t.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).thesis.status).toBe('failures_resolved');

    const late = await paths.POST(
      req('POST', GUEST_A, goodPath(), `/api/saved-theses/${t.id}/failure-paths`),
      ctx(t.id),
    );
    expect(late.status).toBe(409);
    const next = await advance.POST(req('POST', GUEST_A, { to: 'evidence_reviewed' }, url), ctx(t.id));
    expect(next.status).toBe(409);
    expect((await next.json()).code).toBe('blocked');
    const sealed = await advance.POST(req('POST', GUEST_A, { to: 'sealed' }, url), ctx(t.id));
    expect((await sealed.json()).code).toBe('out_of_order');
  });

  it('refuses another owner trying to advance your thesis', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    await addOwnPaths(GUEST_A, t.id, 3);
    const stolen = await advance.POST(
      req('POST', GUEST_B, { to: 'failures_resolved' }, `/api/saved-theses/${t.id}/advance`),
      ctx(t.id),
    );
    expect(stolen.status).toBe(404);
  });

  it('refuses a sixth path', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    await addOwnPaths(GUEST_A, t.id, 5);
    const sixth = await paths.POST(
      req('POST', GUEST_A, goodPath(), `/api/saved-theses/${t.id}/failure-paths`),
      ctx(t.id),
    );
    expect(sixth.status).toBe(409);
  });
});

describe('Uncle writes the paths, you decide', () => {
  it('stores pending paths that block sign-off until each is decided', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    stubQwen(unclePaths(3));
    const made = await generate.POST(
      req('POST', GUEST_A, undefined, `/api/saved-theses/${t.id}/failure-paths/generate`),
      ctx(t.id),
    );
    expect(made.status).toBe(200);
    const thesis = (await made.json()).thesis;
    expect(thesis.failurePaths).toHaveLength(3);
    expect(thesis.premortem.pending).toBe(3);

    const advanceUrl = `/api/saved-theses/${t.id}/advance`;
    const blocked = await advance.POST(req('POST', GUEST_A, { to: 'failures_resolved' }, advanceUrl), ctx(t.id));
    expect(blocked.status).toBe(409);

    const [a, b, c] = thesis.failurePaths as { id: string }[];
    const patch = (id: string, body: unknown) =>
      pathOne.PATCH(
        req('PATCH', GUEST_A, body, `/api/saved-theses/${t.id}/failure-paths/${id}`),
        ctx(t.id, id),
      );
    expect((await patch(a.id, { action: 'accept' })).status).toBe(200);
    expect((await patch(b.id, { action: 'modify', edits: { probability: 0.4 } })).status).toBe(200);
    expect((await patch(c.id, { action: 'reject', reason: 'no' })).status).toBe(400);
    expect((await patch(c.id, { action: 'reject', reason: 'Already hedged with a put option.' })).status).toBe(200);

    const done = await advance.POST(req('POST', GUEST_A, { to: 'failures_resolved' }, advanceUrl), ctx(t.id));
    expect(done.status).toBe(200);
    const saved = (await done.json()).thesis;
    expect(saved.failurePaths[1].modified).toBe(true);
    expect(saved.failurePaths[1].probability).toBe(0.4);
  });

  it('will not let a path be modified without changing anything or into an invalid state', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    stubQwen(unclePaths(3));
    const made = await (
      await generate.POST(
        req('POST', GUEST_A, undefined, `/api/saved-theses/${t.id}/failure-paths/generate`),
        ctx(t.id),
      )
    ).json();
    const id = made.thesis.failurePaths[0].id as string;
    const patch = (body: unknown) =>
      pathOne.PATCH(req('PATCH', GUEST_A, body, `/x`), ctx(t.id, id));
    expect((await patch({ action: 'modify', edits: {} })).status).toBe(400);
    expect((await patch({ action: 'modify', edits: { probability: 4 } })).status).toBe(400);
    expect((await patch({ action: 'modify', edits: { deadline: '2020-01-01' } })).status).toBe(400);
    expect((await patch({ action: 'nonsense' })).status).toBe(400);
  });

  it('stores nothing when Uncle only writes vague paths', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    stubQwen(JSON.stringify({ paths: [{ condition: 'The market turns against it badly.', probability: 0.3 }] }));
    const made = await generate.POST(
      req('POST', GUEST_A, undefined, `/api/saved-theses/${t.id}/failure-paths/generate`),
      ctx(t.id),
    );
    expect(made.status).toBe(502);
    const after = await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json();
    expect(after.thesis.failurePaths).toHaveLength(0);
  });

  it('says so plainly when Uncle is not configured', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    delete process.env.QWEN_BASE_URL;
    delete process.env.QWEN_API_KEY;
    const made = await generate.POST(
      req('POST', GUEST_A, undefined, `/api/saved-theses/${t.id}/failure-paths/generate`),
      ctx(t.id),
    );
    expect(made.status).toBe(503);
  });

  it("only lets you delete paths you wrote, not Uncle's", async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    stubQwen(unclePaths(3));
    const made = await (
      await generate.POST(
        req('POST', GUEST_A, undefined, `/api/saved-theses/${t.id}/failure-paths/generate`),
        ctx(t.id),
      )
    ).json();
    const uncleId = made.thesis.failurePaths[0].id as string;
    expect((await pathOne.DELETE(req('DELETE', GUEST_A), ctx(t.id, uncleId))).status).toBe(409);
    await addOwnPaths(GUEST_A, t.id, 1);
    const own = (await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json()).thesis.failurePaths.find(
      (p: { source: string }) => p.source === 'user',
    );
    expect((await pathOne.DELETE(req('DELETE', GUEST_A), ctx(t.id, own.id))).status).toBe(200);
  });
});

describe('resurfacing', () => {
  it('flags a kept path whose price trigger was crossed, using the Bitget price', async () => {
    resetAll();
    db.__addAsset({
      providerInstrumentId: 'RAAPLUSDT',
      symbol: 'RAAPLUSDT',
      underlyingTicker: 'AAPL',
    });
    const candle = {
      timestamp: new Date().toISOString(),
      open: 165,
      high: 166,
      low: 158,
      close: 160,
      baseVolume: 1,
      quoteVolume: 1,
    };
    db.__addObservation({
      cacheKey: 'RAAPLUSDT:candles:1hour:3',
      fetchedAt: new Date(),
      payload: JSON.stringify({
        instrumentId: 'RAAPLUSDT',
        signalType: 'candles',
        status: 'available',
        value: [candle],
        source: 'bitget',
        observedAt: candle.timestamp,
        fetchedAt: candle.timestamp,
        expiresAt: candle.timestamp,
        stale: false,
      }),
    });
    const t = await newThesis(GUEST_A, { symbol: 'aapl' });
    const detail = (await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json()).thesis;
    expect(detail.instrumentId).toBe('RAAPLUSDT');
    const added = await paths.POST(
      req(
        'POST',
        GUEST_A,
        goodPath({
          condition: 'AAPL closes below 170 on the daily candle before the January earnings call.',
          triggerKind: 'price_below',
          triggerLevel: 170,
          triggerNote: 'Daily close under 170',
        }),
        `/api/saved-theses/${t.id}/failure-paths`,
      ),
      ctx(t.id),
    );
    expect(added.status).toBe(201);

    const seen = await (await watch.GET(req('GET', GUEST_A, undefined, '/api/saved-theses/watch'))).json();
    expect(seen.alerts).toHaveLength(1);
    expect(seen.alerts[0].state).toBe('breached');
    expect(seen.alerts[0].price).toBe(160);

    const stranger = await (await watch.GET(req('GET', GUEST_B, undefined, '/api/saved-theses/watch'))).json();
    expect(stranger.alerts).toHaveLength(0);
  });

  it('refuses a price trigger for a stock Bitget does not list', async () => {
    resetAll();
    const t = await newThesis(GUEST_A, { symbol: 'ZZZZ' });
    const added = await paths.POST(
      req('POST', GUEST_A, goodPath({ triggerKind: 'price_below', triggerLevel: 10 }), `/api/saved-theses/${t.id}/failure-paths`),
      ctx(t.id),
    );
    expect(added.status).toBe(400);
  });
});

describe('Source Lock: the Evidence Shelf', () => {
  const candle = (close: number, at: string) => ({
    timestamp: at,
    open: close,
    high: close,
    low: close,
    close,
    baseVolume: 1,
    quoteVolume: 1,
  });
  const cache = (key: string, rows: ReturnType<typeof candle>[]) =>
    db.__addObservation({
      cacheKey: key,
      fetchedAt: new Date(),
      payload: JSON.stringify({
        instrumentId: 'RAAPLUSDT',
        signalType: 'candles',
        status: 'available',
        value: rows,
        source: 'bitget',
        observedAt: rows[0].timestamp,
        fetchedAt: rows[0].timestamp,
        expiresAt: rows[0].timestamp,
        stale: false,
      }),
    });

  function seedMarket() {
    db.__addAsset({
      providerInstrumentId: 'RAAPLUSDT',
      symbol: 'RAAPLUSDT',
      underlyingTicker: 'AAPL',
      weekendTradable: 'yes',
    });
    cache('RAAPLUSDT:candles:1hour:3', [candle(201.5, new Date().toISOString())]);
    cache(
      'RAAPLUSDT:candles:1day:30',
      Array.from({ length: 10 }, (_, i) =>
        candle(100 + i, new Date(Date.UTC(2026, 9, 1 + i)).toISOString()),
      ),
    );
  }

  async function signedOffThesis(guest: string, extra: Record<string, unknown> = {}) {
    const t = await newThesis(guest, extra);
    await addOwnPaths(guest, t.id, 3);
    const done = await advance.POST(
      req('POST', guest, { to: 'failures_resolved' }, `/api/saved-theses/${t.id}/advance`),
      ctx(t.id),
    );
    expect(done.status).toBe(200);
    return t;
  }
  const base = (id: string) => `/api/saved-theses/${id}/evidence`;
  const refresh = (guest: string, id: string) =>
    evidenceRefresh.POST(req('POST', guest, undefined, `${base(id)}/refresh`), ctx(id));
  const toEvidence = (guest: string, id: string) =>
    advance.POST(
      req('POST', guest, { to: 'evidence_reviewed' }, `/api/saved-theses/${id}/advance`),
      ctx(id),
    );

  it('is closed until the Failure Table is signed off', async () => {
    resetAll();
    const t = await newThesis(GUEST_A);
    expect((await refresh(GUEST_A, t.id)).status).toBe(409);
    const add = await evidence.POST(req('POST', GUEST_A, {}, base(t.id)), ctx(t.id));
    expect(add.status).toBe(409);
  });

  it('binds Bitget claims with a source and timestamp, and holds the stage until inferences are acknowledged', async () => {
    resetAll();
    seedMarket();
    const t = await signedOffThesis(GUEST_A, { symbol: 'AAPL' });
    const made = await (await refresh(GUEST_A, t.id)).json();
    const claims = made.thesis.claims as Record<string, any>[];
    const price = claims.find((c) => c.key === 'last_price')!;
    expect(price.state).toBe('observed');
    expect(price.valueText).toBe('201.5');
    expect(price.observedAt).toBeTruthy();
    expect(price.sourceLabel).toContain('RAAPLUSDT');
    const change = claims.find((c) => c.key === 'change_window')!;
    expect(change.state).toBe('inferred');

    // The inference is not acknowledged yet, so the stage is blocked.
    const blocked = await toEvidence(GUEST_A, t.id);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe('blocked');

    const ack = await evidenceOne.PATCH(
      req('PATCH', GUEST_A, { acknowledge: true }, `${base(t.id)}/${change.id}`),
      claimCtx(t.id, change.id),
    );
    expect(ack.status).toBe(200);
    const ok = await toEvidence(GUEST_A, t.id);
    expect(ok.status).toBe(200);
    expect((await ok.json()).thesis.status).toBe('evidence_reviewed');

    // Signed off: the shelf is frozen.
    expect((await refresh(GUEST_A, t.id)).status).toBe(409);
  });

  it('withholds the value of a claim Bitget cannot support', async () => {
    resetAll();
    const t = await signedOffThesis(GUEST_A, { symbol: 'ZZZZ' });
    const made = await (await refresh(GUEST_A, t.id)).json();
    expect(made.thesis.claims).toHaveLength(1);
    expect(made.thesis.claims[0].state).toBe('insufficient');
    expect(made.thesis.claims[0].valueText).toBeNull();
    expect((await toEvidence(GUEST_A, t.id)).status).toBe(409);
  });

  const secClaim = {
    label: 'FY2025 net sales',
    valueText: '$12.4 billion',
    sourceKind: 'sec_filing',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/10k.htm',
    observedAt: '2026-02-01',
  };
  const serve = (body: string) => {
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    globalThis.fetch = (async () =>
      new Response(`<html><body>${body}</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
  };

  it('refuses a source on the wrong host before fetching anything', async () => {
    resetAll();
    const t = await signedOffThesis(GUEST_A, { symbol: 'ZZZZ' });
    const wrongHost = await evidence.POST(
      req('POST', GUEST_A, { ...secClaim, sourceUrl: 'https://example.com/10k' }, base(t.id)),
      ctx(t.id),
    );
    expect(wrongHost.status).toBe(400);
  });

  it('reads the SEC page and only counts a figure that is on it', async () => {
    resetAll();
    const t = await signedOffThesis(GUEST_A, { symbol: 'ZZZZ' });

    serve('Total net sales were $9.1 billion for the year.');
    const missing = await evidence.POST(req('POST', GUEST_A, secClaim, base(t.id)), ctx(t.id));
    expect(missing.status).toBe(422);

    serve('Total net sales were $12.4 billion for the year.');
    const added = await evidence.POST(req('POST', GUEST_A, secClaim, base(t.id)), ctx(t.id));
    expect(added.status).toBe(201);
    const claim = (await added.json()).thesis.claims[0];
    expect(claim.state).toBe('observed');
    expect(claim.verifiedAt).toBeTruthy();
    expect(claim.excerpt).toContain('12.4');
    expect((await toEvidence(GUEST_A, t.id)).status).toBe(200);
  });

  it('keeps a source amber when the page cannot be read, so it cannot pass the gate', async () => {
    resetAll();
    const t = await signedOffThesis(GUEST_A, { symbol: 'ZZZZ' });
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const added = await evidence.POST(req('POST', GUEST_A, secClaim, base(t.id)), ctx(t.id));
    expect(added.status).toBe(201);
    const claim = (await added.json()).thesis.claims[0];
    expect(claim.state).toBe('inferred');
    expect(claim.verifiedAt).toBeNull();
    expect(claim.note).toContain('unverified');
    expect((await toEvidence(GUEST_A, t.id)).status).toBe(409);
  });

  it('keeps evidence private to its owner and protects Bitget claims from deletion', async () => {
    resetAll();
    seedMarket();
    const t = await signedOffThesis(GUEST_A, { symbol: 'AAPL' });
    const made = await (await refresh(GUEST_A, t.id)).json();
    const priceId = made.thesis.claims.find((c: { key: string }) => c.key === 'last_price').id as string;
    expect((await refresh(GUEST_B, t.id)).status).toBe(404);
    expect((await evidenceOne.DELETE(req('DELETE', GUEST_B), claimCtx(t.id, priceId))).status).toBe(404);
    expect((await evidenceOne.DELETE(req('DELETE', GUEST_A), claimCtx(t.id, priceId))).status).toBe(409);
    const nothing = await evidenceOne.PATCH(
      req('PATCH', GUEST_A, { acknowledge: true }, 'x'),
      claimCtx(t.id, priceId),
    );
    expect(nothing.status).toBe(409); // an observed fact needs no acknowledgement
  });
});

describe('Probability Seal', () => {
  const DAY = 86_400_000;
  const todayStart = () => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const candle = (close: number, at: number) => ({
    timestamp: new Date(at).toISOString(),
    open: close,
    high: close,
    low: close,
    close,
    baseVolume: 1,
    quoteVolume: 1,
  });
  const cache = (key: string, rows: ReturnType<typeof candle>[]) =>
    db.__addObservation({
      cacheKey: key,
      fetchedAt: new Date(),
      payload: JSON.stringify({
        instrumentId: 'RAAPLUSDT',
        signalType: 'candles',
        status: 'available',
        value: rows,
        source: 'bitget',
        observedAt: rows[0].timestamp,
        fetchedAt: rows[0].timestamp,
        expiresAt: rows[0].timestamp,
        stale: false,
      }),
    });
  /** `n` daily candles ending today, closing 100, 101, … so the last close is 100 + n - 1. */
  function seedMarket(n = 100) {
    db.__addAsset({
      providerInstrumentId: 'RAAPLUSDT',
      symbol: 'RAAPLUSDT',
      underlyingTicker: 'AAPL',
      weekendTradable: 'yes',
    });
    const rows = Array.from({ length: n }, (_, i) => candle(100 + i, todayStart() - (n - 1 - i) * DAY));
    cache('RAAPLUSDT:candles:1day:100', rows);
    cache('RAAPLUSDT:candles:1day:30', rows.slice(-30));
    cache('RAAPLUSDT:candles:1hour:3', [candle(100 + n - 1, Date.now())]);
    return rows;
  }

  async function reviewedThesis(guest: string) {
    const t = await newThesis(guest, { symbol: 'AAPL' });
    await addOwnPaths(guest, t.id, 3);
    await advance.POST(
      req('POST', guest, { to: 'failures_resolved' }, `/api/saved-theses/${t.id}/advance`),
      ctx(t.id),
    );
    const made = await (
      await evidenceRefresh.POST(req('POST', guest, undefined, `/e`), ctx(t.id))
    ).json();
    for (const c of made.thesis.claims as { id: string; state: string }[])
      if (c.state === 'inferred')
        await evidenceOne.PATCH(req('PATCH', guest, { acknowledge: true }, '/x'), claimCtx(t.id, c.id));
    const done = await advance.POST(
      req('POST', guest, { to: 'evidence_reviewed' }, `/api/saved-theses/${t.id}/advance`),
      ctx(t.id),
    );
    expect(done.status).toBe(200);
    return t;
  }

  const sealIt = (guest: string, id: string, body: Record<string, unknown>) =>
    seal.POST(req('POST', guest, body, `/api/saved-theses/${id}/seal`), ctx(id));

  function qwenReplies(probability: unknown, capture?: { body: string }) {
    process.env.QWEN_BASE_URL = 'http://qwen.test';
    process.env.QWEN_API_KEY = 'test';
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      if (capture) capture.body = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ probability, rationale: 'Momentum is mixed.' }) } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
  }

  it('is closed until the Evidence Shelf is signed off', async () => {
    resetAll();
    seedMarket();
    const t = await newThesis(GUEST_A, { symbol: 'AAPL' });
    const early = await sealIt(GUEST_A, t.id, { direction: 'up', probability: 0.6, horizonDays: 7 });
    expect(early.status).toBe(409);
    expect((await early.json()).code).toBe('out_of_order');
  });

  it('seals your forecast next to Uncle\'s, which never saw yours, and then refuses to change it', async () => {
    resetAll();
    seedMarket();
    const t = await reviewedThesis(GUEST_A);
    const capture = { body: '' };
    qwenReplies(0.62, capture);
    const made = await sealIt(GUEST_A, t.id, { direction: 'up', probability: 0.7312, horizonDays: 7 });
    expect(made.status).toBe(201);
    const view = (await made.json()).thesis;
    expect(view.status).toBe('sealed');
    expect(view.seal.userProbability).toBe(0.7312);
    expect(view.seal.systemProbability).toBe(0.62);
    expect(view.seal.systemMethod).toBe('uncle');
    expect(view.seal.referencePrice).toBe(199);
    expect(view.seal.status).toBe('open');
    expect(view.seal.resolvesAt > view.seal.sealedAt).toBe(true);
    expect(capture.body.includes('7312')).toBe(false);

    expect((await sealIt(GUEST_A, t.id, { direction: 'down', probability: 0.2, horizonDays: 7 })).status).toBe(409);
    const adv = await advance.POST(
      req('POST', GUEST_A, { to: 'sealed' }, `/api/saved-theses/${t.id}/advance`),
      ctx(t.id),
    );
    expect(adv.status).toBe(409);
    expect((await one.DELETE(req('DELETE', GUEST_A), ctx(t.id))).status).toBe(409);
  });

  it('rejects certainty, a missing direction and an out-of-range horizon', async () => {
    resetAll();
    seedMarket();
    const t = await reviewedThesis(GUEST_A);
    qwenReplies(0.6);
    for (const body of [
      { direction: 'up', probability: 1, horizonDays: 7 },
      { direction: 'up', probability: 0, horizonDays: 7 },
      { direction: 'sideways', probability: 0.5, horizonDays: 7 },
      { direction: 'up', probability: 0.5, horizonDays: 0 },
      { direction: 'up', probability: 0.5, horizonDays: 200 },
    ])
      expect((await sealIt(GUEST_A, t.id, body)).status).toBe(400);
    // Nothing was sealed by the failed attempts.
    const after = (await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json()).thesis;
    expect(after.status).toBe('evidence_reviewed');
  });

  it('falls back to the base rate when Uncle is unavailable, and says so', async () => {
    resetAll();
    seedMarket();
    const t = await reviewedThesis(GUEST_A);
    delete process.env.QWEN_BASE_URL;
    delete process.env.QWEN_API_KEY;
    const made = await sealIt(GUEST_A, t.id, { direction: 'up', probability: 0.6, horizonDays: 7 });
    expect(made.status).toBe(201);
    const view = (await made.json()).thesis;
    expect(view.seal.systemMethod).toBe('base_rate');
    expect(view.seal.systemProbability).toBe(0.95);
    expect(view.seal.baseRate).toBe(1);
  });

  it('refuses to seal when Uncle is down and there is no history for a base rate', async () => {
    resetAll();
    seedMarket(20);
    const t = await reviewedThesis(GUEST_A);
    delete process.env.QWEN_BASE_URL;
    delete process.env.QWEN_API_KEY;
    const made = await sealIt(GUEST_A, t.id, { direction: 'up', probability: 0.6, horizonDays: 15 });
    expect(made.status).toBe(503);
    const after = (await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json()).thesis;
    expect(after.status).toBe('evidence_reviewed');
    expect(after.seal).toBeNull();
  });

  it('keeps seals private to their owner', async () => {
    resetAll();
    seedMarket();
    const t = await reviewedThesis(GUEST_A);
    qwenReplies(0.6);
    expect((await sealIt(GUEST_B, t.id, { direction: 'up', probability: 0.6, horizonDays: 7 })).status).toBe(404);
    const stranger = await (await calibrationRoute.GET(req('GET', GUEST_B, undefined, '/c'))).json();
    expect(stranger.entries).toHaveLength(0);
  });

  it('judges a seal once, after its day has ended, and scores both forecasts', async () => {
    resetAll();
    const rows = seedMarket();
    const t = await reviewedThesis(GUEST_A);
    qwenReplies(0.6);
    const made = await sealIt(GUEST_A, t.id, { direction: 'up', probability: 0.7, horizonDays: 7 });
    const sealView = (await made.json()).thesis.seal;
    const resolvesAt = new Date(sealView.resolvesAt);

    // Too early: nothing is judged.
    expect(await resolveDueSeals(db as never, `g:${GUEST_A}`, new Date(resolvesAt.getTime() - 1000))).toBe(0);

    // Bitget now returns the resolving day: the close is 210, above the 199 reference.
    const resolvingDay = candle(210, resolvesAt.getTime() - DAY);
    cache('RAAPLUSDT:candles:1day:100', [...rows, resolvingDay]);
    const after = new Date(resolvesAt.getTime() + 3_600_000);
    expect(await resolveDueSeals(db as never, `g:${GUEST_A}`, after)).toBe(1);
    // Judged once: a second pass changes nothing.
    expect(await resolveDueSeals(db as never, `g:${GUEST_A}`, after)).toBe(0);

    const detail = (await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json()).thesis.seal;
    expect(detail.status).toBe('resolved');
    expect(detail.outcome).toBe(true);
    expect(detail.resolvedPrice).toBe(210);
    expect(Math.abs(detail.userBrier - 0.09) < 1e-9).toBe(true);
    expect(Math.abs(detail.systemBrier - 0.16) < 1e-9).toBe(true);

    const ledger = await (await calibrationRoute.GET(req('GET', GUEST_A, undefined, '/c'))).json();
    expect(ledger.calibration.resolved).toBe(1);
    expect(ledger.calibration.better).toBe('you');
    expect(ledger.entries).toHaveLength(1);
  });

  it('scores a wrong call: a down seal on a rising close', async () => {
    resetAll();
    const rows = seedMarket();
    const t = await reviewedThesis(GUEST_A);
    qwenReplies(0.3);
    const made = await sealIt(GUEST_A, t.id, { direction: 'down', probability: 0.9, horizonDays: 3 });
    const resolvesAt = new Date((await made.json()).thesis.seal.resolvesAt);
    cache('RAAPLUSDT:candles:1day:100', [...rows, candle(205, resolvesAt.getTime() - DAY)]);
    await resolveDueSeals(db as never, `g:${GUEST_A}`, new Date(resolvesAt.getTime() + 1000));
    const detail = (await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json()).thesis.seal;
    expect(detail.outcome).toBe(false);
    expect(Math.abs(detail.userBrier - 0.81) < 1e-9).toBe(true);
    expect(Math.abs(detail.systemBrier - 0.09) < 1e-9).toBe(true);
  });
});

describe('Balance Scale', () => {
  const DAY = 86_400_000;
  const todayStart = () => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const candle = (close: number, at: number) => ({
    timestamp: new Date(at).toISOString(),
    open: close,
    high: close,
    low: close,
    close,
    baseVolume: 1,
    quoteVolume: 1,
  });
  const cache = (instrumentId: string, key: string, rows: ReturnType<typeof candle>[]) =>
    db.__addObservation({
      cacheKey: `${instrumentId}:candles:${key}`,
      fetchedAt: new Date(),
      payload: JSON.stringify({
        instrumentId,
        signalType: 'candles',
        status: 'available',
        value: rows,
        source: 'bitget',
        observedAt: rows[0].timestamp,
        fetchedAt: rows[0].timestamp,
        expiresAt: rows[0].timestamp,
        stale: false,
      }),
    });
  const closes = (i: number) => 100 + i + 3 * Math.sin(i / 2);
  function seedStock(instrumentId: string, ticker: string, n = 100) {
    db.__addAsset({ providerInstrumentId: instrumentId, symbol: instrumentId, underlyingTicker: ticker, weekendTradable: 'yes' });
    const rows = Array.from({ length: n }, (_, i) => candle(closes(i), todayStart() - (n - 1 - i) * DAY));
    cache(instrumentId, '1day:100', rows);
    cache(instrumentId, '1day:30', rows.slice(-30));
    cache(instrumentId, '1hour:3', [candle(closes(n - 1), Date.now())]);
  }

  async function sealedThesis(guest: string) {
    const t = await newThesis(guest, { symbol: 'AAPL' });
    await addOwnPaths(guest, t.id, 3);
    await advance.POST(req('POST', guest, { to: 'failures_resolved' }, `/api/saved-theses/${t.id}/advance`), ctx(t.id));
    const made = await (await evidenceRefresh.POST(req('POST', guest, undefined, '/e'), ctx(t.id))).json();
    for (const c of made.thesis.claims as { id: string; state: string }[])
      if (c.state === 'inferred')
        await evidenceOne.PATCH(req('PATCH', guest, { acknowledge: true }, '/x'), claimCtx(t.id, c.id));
    await advance.POST(req('POST', guest, { to: 'evidence_reviewed' }, `/api/saved-theses/${t.id}/advance`), ctx(t.id));
    process.env.QWEN_BASE_URL = 'http://qwen.test';
    process.env.QWEN_API_KEY = 'test';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"probability":0.6,"rationale":"Mixed."}' } }] }), {
        status: 200,
      })) as typeof fetch;
    const sealed = await seal.POST(
      req('POST', guest, { direction: 'up', probability: 0.6, horizonDays: 7 }, '/s'),
      ctx(t.id),
    );
    expect(sealed.status).toBe(201);
    return t;
  }

  const putPortfolio = (guest: string, body: unknown) =>
    portfolioRoute.PUT(req('PUT', guest, body, '/api/portfolio'));
  const lock = (guest: string, id: string, body: Record<string, unknown>) =>
    lockRoute.POST(req('POST', guest, body, `/api/saved-theses/${id}/lock`), ctx(id));
  const risk = (guest: string, id: string, body: Record<string, unknown>) =>
    riskRoute.POST(req('POST', guest, body, `/api/saved-theses/${id}/risk`), ctx(id));
  const cash = { totalUsd: 10_000 };

  it('is closed until the thesis is sealed', async () => {
    resetAll();
    seedStock('RAAPLUSDT', 'AAPL');
    const t = await newThesis(GUEST_A, { symbol: 'AAPL' });
    expect((await lock(GUEST_A, t.id, { plannedUsd: 500 })).status).toBe(409);
    expect((await risk(GUEST_A, t.id, { plannedUsd: 500 })).status).toBe(409);
  });

  it('stores your typed portfolio privately and checks it', async () => {
    resetAll();
    expect((await putPortfolio(GUEST_A, { totalUsd: 0 })).status).toBe(400);
    expect((await putPortfolio(GUEST_A, { totalUsd: 1000, holdings: [{ symbol: 'AAPL', valueUsd: 5000 }] })).status).toBe(400);
    expect((await putPortfolio(GUEST_A, { ...cash, holdings: [{ symbol: 'msft', valueUsd: 2000 }] })).status).toBe(200);
    const mine = await (await portfolioRoute.GET(req('GET', GUEST_A, undefined, '/api/portfolio'))).json();
    expect(mine.portfolio.holdings[0].symbol).toBe('MSFT');
    const theirs = await (await portfolioRoute.GET(req('GET', GUEST_B, undefined, '/api/portfolio'))).json();
    expect(theirs.portfolio).toBeNull();
  });

  it('needs a portfolio before it will measure anything', async () => {
    resetAll();
    seedStock('RAAPLUSDT', 'AAPL');
    const t = await sealedThesis(GUEST_A);
    const none = await lock(GUEST_A, t.id, { plannedUsd: 500 });
    expect(none.status).toBe(409);
    expect((await none.json()).code).toBe('no_portfolio');
  });

  it('serves a small position with nothing to acknowledge, and then never changes it', async () => {
    resetAll();
    seedStock('RAAPLUSDT', 'AAPL');
    const t = await sealedThesis(GUEST_A);
    await putPortfolio(GUEST_A, cash);
    const preview = await (await risk(GUEST_A, t.id, { plannedUsd: 500 })).json();
    expect(preview.report.metrics).toHaveLength(4);
    expect(preview.report.verdict).toBe('clear');

    const served = await lock(GUEST_A, t.id, { plannedUsd: 500 });
    expect(served.status).toBe(201);
    const view = (await served.json()).thesis;
    expect(view.status).toBe('locked');
    expect(view.lock.verdict).toBe('clear');
    expect(view.lock.metrics).toHaveLength(4);

    expect((await lock(GUEST_A, t.id, { plannedUsd: 500 })).status).toBe(409);
    expect((await one.DELETE(req('DELETE', GUEST_A), ctx(t.id))).status).toBe(409);
  });

  it('makes you acknowledge each soft warning by name', async () => {
    resetAll();
    seedStock('RAAPLUSDT', 'AAPL');
    const t = await sealedThesis(GUEST_A);
    await putPortfolio(GUEST_A, cash);
    const without = await lock(GUEST_A, t.id, { plannedUsd: 1200 });
    expect(without.status).toBe(409);
    expect((await without.json()).error).toContain('concentration');
    const wrong = await lock(GUEST_A, t.id, { plannedUsd: 1200, acknowledged: ['gap'] });
    expect(wrong.status).toBe(409);
    const ok = await lock(GUEST_A, t.id, { plannedUsd: 1200, acknowledged: ['concentration'] });
    expect(ok.status).toBe(201);
    expect((await ok.json()).thesis.lock.verdict).toBe('warn');
  });

  it('refuses a hard limit unless you acknowledge it and write a reason, and keeps the reason', async () => {
    resetAll();
    seedStock('RAAPLUSDT', 'AAPL');
    const t = await sealedThesis(GUEST_A);
    await putPortfolio(GUEST_A, cash);
    expect((await lock(GUEST_A, t.id, { plannedUsd: 3000 })).status).toBe(409);
    expect((await lock(GUEST_A, t.id, { plannedUsd: 3000, acknowledged: ['concentration'] })).status).toBe(409);
    expect(
      (await lock(GUEST_A, t.id, { plannedUsd: 3000, acknowledged: ['concentration'], overrideReason: 'too short' })).status,
    ).toBe(409);
    const after = (await (await one.GET(req('GET', GUEST_A), ctx(t.id))).json()).thesis;
    expect(after.status).toBe('sealed');
    const served = await lock(GUEST_A, t.id, {
      plannedUsd: 3000,
      acknowledged: ['concentration'],
      overrideReason: 'Hedged with puts on the same stock elsewhere.',
    });
    expect(served.status).toBe(201);
    const view = (await served.json()).thesis;
    expect(view.lock.verdict).toBe('override');
    expect(view.lock.overrideReason).toContain('Hedged');
  });

  it('measures correlation against holdings Bitget lists, and says which it could not measure', async () => {
    resetAll();
    seedStock('RAAPLUSDT', 'AAPL');
    seedStock('RMSFTUSDT', 'MSFT');
    const t = await sealedThesis(GUEST_A);
    await putPortfolio(GUEST_A, {
      totalUsd: 10_000,
      holdings: [{ symbol: 'MSFT', valueUsd: 5000 }, { symbol: 'PRIV', valueUsd: 500 }],
    });
    const report = (await (await risk(GUEST_A, t.id, { plannedUsd: 500 })).json()).report;
    const corr = report.metrics.find((m: { key: string }) => m.key === 'correlation');
    expect(corr.level).toBe('block');
    expect(corr.message).toContain('PRIV');
  });

  it('keeps risk checks private to the owner', async () => {
    resetAll();
    seedStock('RAAPLUSDT', 'AAPL');
    const t = await sealedThesis(GUEST_A);
    await putPortfolio(GUEST_B, cash);
    expect((await risk(GUEST_B, t.id, { plannedUsd: 500 })).status).toBe(404);
    expect((await lock(GUEST_B, t.id, { plannedUsd: 500 })).status).toBe(404);
  });
});
