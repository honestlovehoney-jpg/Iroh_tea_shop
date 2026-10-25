import { MAX_QUESTION_LENGTH } from '../chat/limits';
import type {
  Conviction,
  ConvictionLevel,
  DeckSnapshot,
  Thesis,
  ThesisId,
  ThesisSummary,
} from '../thesis/types';

export type DeckState =
  | { status: 'loading' }
  | { status: 'offline'; reason: string }
  | { status: 'ready'; snapshot: DeckSnapshot };

export const LEVEL_LABEL: Record<ConvictionLevel, string> = {
  weak: 'Weak',
  steeping: 'Building',
  strong: 'Strong',
  unknown: 'No signal',
};

export function convictionTitle(level: ConvictionLevel): string {
  return level === 'unknown'
    ? 'No momentum signal'
    : `${LEVEL_LABEL[level]} momentum`;
}

/** What the average figure measures. */
export const WINDOW_LABEL = 'avg · 7 days';
export const WINDOW_LABEL_SHORT = 'avg · 7d';

/** Tea strength glyphs for the conviction seal: light, steeping, strong. */
export const LEVEL_GLYPH: Record<ConvictionLevel, string> = {
  weak: '淡',
  steeping: '沏',
  strong: '濃',
  unknown: '未',
};

export function formatPct(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatVolume(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDay(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  return new Date(time).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'time unknown';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'time unknown';
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** The error text a shop API answer carries, or a plain fallback; never raw exception text. */
export async function shopErrorText(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  if (typeof body?.error === 'string') return body.error;
  return 'Bitget data is unavailable right now.';
}

export function risingLine(conviction: Conviction, total: number): string {
  return `${conviction.rising} of ${total} rising`;
}

/** One line that explains the meter in plain words. */
export function convictionSentence(
  conviction: Conviction,
  total: number,
): string {
  const stocks = total === 1 ? 'stock' : 'stocks';
  const gap =
    conviction.measured < total ? ` (${conviction.measured} with data)` : '';
  return `${conviction.rising} of ${total} ${stocks} rose over the last 7 days${gap}`;
}

export function buildUncleDraft(
  thesis: Thesis,
  summary: ThesisSummary | null,
): string {
  const level = summary?.conviction.level ?? 'unknown';
  const premise =
    level === 'unknown'
      ? `test “${thesis.title}” against Bitget data.`
      : `momentum on “${thesis.title}” is ${LEVEL_LABEL[level].toLowerCase()}.`;
  return `Uncle, ${premise} What could disprove it?`.slice(
    0,
    MAX_QUESTION_LENGTH,
  );
}

export function thesisLink(origin: string, id: ThesisId): string {
  return `${origin}/?thesis=${id}`;
}

export function shareText(
  thesis: Thesis,
  summary: ThesisSummary | null,
): string {
  const line = summary
    ? `${convictionSentence(summary.conviction, thesis.tickers.length)}.`
    : 'Checking Bitget price evidence.';
  return `Thesis: ${thesis.title}. ${line} Data from Bitget.`;
}

export function xIntentUrl(
  thesis: Thesis,
  summary: ThesisSummary | null,
  origin: string,
): string {
  const params = new URLSearchParams({
    text: shareText(thesis, summary),
    url: thesisLink(origin, thesis.id),
  });
  return `https://x.com/intent/post?${params.toString()}`;
}
