import 'server-only';
import { SOURCE_HOSTS, type SourceKind } from './evidence';
import { htmlToText, verifyFigure, type Verification } from './source-verify';

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const TEXT_TYPES = /^(text\/(html|plain|xml)|application\/(xhtml\+xml|xml))/i;

export type SourceCheck =
  | { status: 'verified'; verification: Verification; finalUrl: string }
  | { status: 'not_found'; finalUrl: string }
  | { status: 'unreadable'; reason: string };

const hostAllowed = (kind: SourceKind, host: string) =>
  (SOURCE_HOSTS[kind] ?? []).some((h) => host === h || host.endsWith(`.${h}`));

/**
 * Fetch a primary-source page and look for the figure the person stated.
 * Only the primary hosts for the claim's kind are ever contacted, over https,
 * and a redirect off those hosts is not followed. Nothing else is requested,
 * so a link cannot be used to reach other servers.
 */
export async function checkPrimarySource(
  kind: SourceKind,
  url: string,
  valueText: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceCheck> {
  const agent = process.env.SOURCE_FETCH_USER_AGENT?.trim();
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { status: 'unreadable', reason: 'The link is not a valid address.' };
  }
  // sec.gov refuses requests that do not say who is asking.
  if (!agent && kind === 'sec_filing')
    return {
      status: 'unreadable',
      reason:
        'The server has no SOURCE_FETCH_USER_AGENT set, which sec.gov requires, so the filing could not be read.',
    };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (
      current.protocol !== 'https:' ||
      !hostAllowed(kind, current.hostname.toLowerCase())
    )
      return {
        status: 'unreadable',
        reason:
          'The link leads away from the primary source, so it was not followed.',
      };
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        redirect: 'manual',
        headers: {
          'user-agent': agent || 'IrohTeaShop/1.0 (source verification)',
          accept:
            'text/html,text/plain,application/xhtml+xml,application/xml;q=0.9',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return {
        status: 'unreadable',
        reason: 'The source did not answer in time.',
      };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location)
        return {
          status: 'unreadable',
          reason: 'The source redirected without a destination.',
        };
      try {
        current = new URL(location, current);
      } catch {
        return {
          status: 'unreadable',
          reason: 'The source redirected to an invalid address.',
        };
      }
      continue;
    }
    if (!response.ok)
      return {
        status: 'unreadable',
        reason: `The source answered with status ${response.status}.`,
      };
    const type = response.headers.get('content-type') ?? '';
    if (!TEXT_TYPES.test(type))
      return {
        status: 'unreadable',
        reason:
          'The page is not text or HTML (for example a PDF), so it could not be read.',
      };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES)
      return {
        status: 'unreadable',
        reason: 'The page is too large to check.',
      };

    const body = await readCapped(response);
    if (body === null)
      return {
        status: 'unreadable',
        reason: 'The page is too large to check.',
      };
    const text = /html|xml/i.test(type) ? htmlToText(body) : body;
    const verification = verifyFigure(valueText, text, label);
    return verification.found
      ? { status: 'verified', verification, finalUrl: current.toString() }
      : { status: 'not_found', finalUrl: current.toString() };
  }
  return {
    status: 'unreadable',
    reason: 'The source redirected too many times.',
  };
}

async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}
