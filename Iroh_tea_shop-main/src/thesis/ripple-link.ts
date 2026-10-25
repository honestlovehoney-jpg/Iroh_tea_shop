import type { Thesis } from './types';

/**
 * Link to the separate Ripple Room app, with this thesis's stocks filled in.
 * Returns null when no valid http(s) address is configured, so the link stays hidden.
 */
export function rippleRoomUrl(
  thesis: Thesis,
  base: string | undefined = process.env.NEXT_PUBLIC_RIPPLE_ROOM_URL,
): string | null {
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const [first, ...rest] = thesis.tickers.map((ticker) => ticker.symbol);
  if (!first || !rest.length) return null;
  url.searchParams.set('primary', first);
  url.searchParams.set('others', rest.join(','));
  return url.toString();
}
