// Source Lock rules. Pure functions with no imports from the server, so the
// routes, the page and the tests all apply the same checks.

export type ClaimState = 'observed' | 'inferred' | 'insufficient';
export type SourceKind =
  | 'bitget_market'
  | 'sec_filing'
  | 'company_release'
  | 'central_bank';

export const USER_SOURCE_KINDS: readonly SourceKind[] = [
  'sec_filing',
  'company_release',
  'central_bank',
];

/** Hosts whose pages count as the primary source for each kind. A claim from any other host is refused. */
export const SOURCE_HOSTS: Partial<Record<SourceKind, string[]>> = {
  sec_filing: ['sec.gov'],
  central_bank: [
    'federalreserve.gov',
    'ecb.europa.eu',
    'bankofengland.co.uk',
    'bis.org',
    'cbn.gov.ng',
  ],
};

/** System evidence older than this has to be refreshed before the stage can be signed off. */
export const EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_WINDOW_CANDLES = 5;
const MAX_AGE_YEARS = 10;

export interface ClaimFields {
  key: string;
  origin: 'system' | 'user';
  label: string;
  /** Null when the claim is insufficient: nothing is shown in its place. */
  valueText: string | null;
  state: ClaimState;
  sourceKind: SourceKind;
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: string | null;
  fetchedAt: string;
  marketClosed: boolean;
  note: string | null;
  /** Set when the app read the source page and found the figure. */
  verifiedAt?: string | null;
  excerpt?: string | null;
}

export interface StoredClaimState {
  state: ClaimState;
  origin: 'system' | 'user';
  acknowledged: boolean;
  fetchedAt: string;
}

/**
 * Is the US cash market (the reference market for tokenized US stocks) open?
 * Weekdays 09:30 to 16:00 New York time. Exchange holidays are not covered:
 * on those days a "closed" flag may be missing, so the note says so.
 */
export function usMarketOpen(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export interface PriceInput {
  price: number;
  asOf: string;
}
export interface CandleInput {
  timestamp: string;
  close: number;
}

export interface MarketEvidenceInput {
  symbol: string | null;
  instrumentId: string | null;
  price: PriceInput | null;
  /** Daily candles from Bitget, any order. */
  daily: CandleInput[] | null;
  weekendTradable: string | null;
  now: Date;
}

const BITGET = 'Bitget market data';

function insufficient(
  key: string,
  label: string,
  note: string,
  now: Date,
): ClaimFields {
  return {
    key,
    origin: 'system',
    label,
    valueText: null,
    state: 'insufficient',
    sourceKind: 'bitget_market',
    sourceLabel: BITGET,
    sourceUrl: null,
    observedAt: null,
    fetchedAt: now.toISOString(),
    marketClosed: false,
    note,
  };
}

/** Build the system claims from Bitget evidence. Anything it cannot support is withheld, never filled in. */
export function buildMarketClaims(input: MarketEvidenceInput): ClaimFields[] {
  const { now } = input;
  const who = input.symbol ?? 'this stock';
  const claims: ClaimFields[] = [];

  if (!input.instrumentId) {
    return [
      insufficient(
        'last_price',
        `${who} last price`,
        'Bitget does not list this stock, so there is no market data to bind.',
        now,
      ),
    ];
  }

  if (input.price) {
    const asOf = new Date(input.price.asOf);
    const closed = !usMarketOpen(asOf) || !usMarketOpen(now);
    claims.push({
      key: 'last_price',
      origin: 'system',
      label: `${who} last price`,
      valueText: String(input.price.price),
      state: 'observed',
      sourceKind: 'bitget_market',
      sourceLabel: `${BITGET}, ${input.instrumentId}, hourly close`,
      sourceUrl: null,
      observedAt: asOf.toISOString(),
      fetchedAt: now.toISOString(),
      marketClosed: closed,
      note: closed
        ? 'The US reference market is closed (weekend or after hours). The token price may be thin or stale. US exchange holidays are not checked.'
        : null,
    });
  } else {
    claims.push(
      insufficient(
        'last_price',
        `${who} last price`,
        'Bitget returned no usable price.',
        now,
      ),
    );
  }

  const daily = [...(input.daily ?? [])]
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (daily.length >= MIN_WINDOW_CANDLES) {
    const first = daily[0];
    const last = daily[daily.length - 1];
    const change = (last.close / first.close - 1) * 100;
    claims.push({
      key: 'change_window',
      origin: 'system',
      label: `${who} change over ${daily.length} daily candles`,
      valueText: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
      state: 'inferred',
      sourceKind: 'bitget_market',
      sourceLabel: `${BITGET}, ${input.instrumentId}, daily candles`,
      sourceUrl: null,
      observedAt: new Date(last.timestamp).toISOString(),
      fetchedAt: now.toISOString(),
      marketClosed: false,
      note: `Computed by this app from the close of ${first.timestamp.slice(0, 10)} (${first.close}) to the close of ${last.timestamp.slice(0, 10)} (${last.close}). It is arithmetic on observed data, not a quoted figure.`,
    });
  } else {
    claims.push(
      insufficient(
        'change_window',
        `${who} recent change`,
        `Only ${daily.length} daily candles came back; ${MIN_WINDOW_CANDLES} are needed.`,
        now,
      ),
    );
  }

  if (input.weekendTradable) {
    claims.push({
      key: 'weekend_tradable',
      origin: 'system',
      label: `${who} weekend trading on Bitget`,
      valueText: input.weekendTradable,
      state: 'observed',
      sourceKind: 'bitget_market',
      sourceLabel: `${BITGET}, catalog entry for ${input.instrumentId}`,
      sourceUrl: null,
      observedAt: null,
      fetchedAt: now.toISOString(),
      marketClosed: false,
      note: null,
    });
  }
  return claims;
}

export type ClaimValidation =
  | {
      ok: true;
      value: ClaimFields;
      /** True when the app must fetch the page and find the figure before it counts as observed. */
      verify: boolean;
    }
  | { ok: false; errors: string[] };

/**
 * Check a source the person supplies. SEC filings and central bank statements
 * must sit on a known primary host, and then the app fetches the page and has
 * to find the figure on it before the claim counts as observed (until then it
 * is amber). A company release cannot be verified as official, so it stays
 * amber.
 */
export function validateUserClaim(input: unknown, now: Date): ClaimValidation {
  if (typeof input !== 'object' || input === null)
    return { ok: false, errors: ['A claim must be an object.'] };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];

  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label.length < 3 || label.length > 120)
    errors.push('Name the claim in 3 to 120 characters.');
  const valueText =
    typeof raw.valueText === 'string' ? raw.valueText.trim() : '';
  if (valueText.length < 1 || valueText.length > 200)
    errors.push('State the figure or fact in 1 to 200 characters.');

  const kind = USER_SOURCE_KINDS.find((k) => k === raw.sourceKind);
  if (!kind)
    errors.push(
      'The source must be an SEC filing, a company release or a central bank statement.',
    );

  let url: URL | null = null;
  try {
    url = new URL(
      typeof raw.sourceUrl === 'string' ? raw.sourceUrl.trim() : '',
    );
    if (url.protocol !== 'https:') {
      errors.push('The source link must start with https://.');
      url = null;
    }
  } catch {
    errors.push('Give the link to the source.');
  }

  const observedMs =
    typeof raw.observedAt === 'string' ? Date.parse(raw.observedAt) : NaN;
  if (!Number.isFinite(observedMs))
    errors.push('Give the date the source was published.');
  else if (observedMs > now.getTime())
    errors.push('The source date cannot be in the future.');
  else if (now.getTime() - observedMs > MAX_AGE_YEARS * 365 * 86_400_000)
    errors.push('That source is more than ten years old.');

  const state: ClaimState = 'inferred';
  let verify = false;
  let note: string | null = null;
  if (kind && url) {
    const hosts = SOURCE_HOSTS[kind];
    if (hosts) {
      const host = url.hostname.toLowerCase();
      const onPrimary = hosts.some((h) => host === h || host.endsWith(`.${h}`));
      if (!onPrimary)
        errors.push(
          `A ${kind.replace('_', ' ')} must link to ${hosts.join(', ')}.`,
        );
      else verify = true;
    } else {
      note =
        'A company page cannot be verified as the official release, so this stays amber until you accept it.';
    }
  }

  if (errors.length || !kind || !url) return { ok: false, errors };
  return {
    ok: true,
    verify,
    value: {
      key: 'user',
      origin: 'user',
      label,
      valueText,
      state,
      sourceKind: kind,
      sourceLabel: url.hostname,
      sourceUrl: url.toString(),
      observedAt: new Date(observedMs).toISOString(),
      fetchedAt: now.toISOString(),
      marketClosed: false,
      note,
    },
  };
}

export interface EvidenceStatus {
  complete: boolean;
  observed: number;
  inferred: number;
  insufficient: number;
  unacknowledged: number;
  blockers: string[];
}

/** The Evidence Shelf gate. */
export function evidenceStatus(
  claims: StoredClaimState[],
  now: Date,
): EvidenceStatus {
  const observed = claims.filter((c) => c.state === 'observed').length;
  const inferred = claims.filter((c) => c.state === 'inferred').length;
  const insufficient = claims.filter((c) => c.state === 'insufficient').length;
  const unacknowledged = claims.filter(
    (c) => c.state === 'inferred' && !c.acknowledged,
  ).length;
  const blockers: string[] = [];
  if (observed === 0)
    blockers.push(
      'No observed fact is bound yet. Refresh the Bitget evidence, or add an SEC filing or central bank statement.',
    );
  if (unacknowledged > 0)
    blockers.push(
      `${unacknowledged} model inference${unacknowledged === 1 ? ' is' : 's are'} not acknowledged yet.`,
    );
  const stale = claims.filter(
    (c) =>
      c.origin === 'system' &&
      now.getTime() - Date.parse(c.fetchedAt) > EVIDENCE_MAX_AGE_MS,
  ).length;
  if (stale > 0)
    blockers.push('The Bitget evidence is more than a day old. Refresh it.');
  return {
    complete: blockers.length === 0,
    observed,
    inferred,
    insufficient,
    unacknowledged,
    blockers,
  };
}

/** Can the evidence still change? Frozen once the Evidence Shelf is signed off. */
export const evidenceEditable = (status: string) =>
  status === 'failures_resolved';
