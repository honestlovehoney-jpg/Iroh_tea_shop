// Reading a fetched page and checking a stated figure against it.
// Pure functions: no network, so the tests run the same code the route runs.

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&#8212;': '-',
  '&#8211;': '-',
  '&mdash;': '-',
  '&ndash;': '-',
};

/** Page text without scripts, styles or tags. Good enough to find a figure; not a renderer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity) => {
      const known = ENTITIES[entity.toLowerCase()];
      if (known !== undefined) return known;
      const code = /^&#x([0-9a-f]+);$/i.exec(entity)?.[1];
      const dec = /^&#(\d+);$/.exec(entity)?.[1];
      const point = code ? parseInt(code, 16) : dec ? parseInt(dec, 10) : NaN;
      return Number.isFinite(point) && point < 0x110000
        ? String.fromCodePoint(point)
        : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ');

/** Numbers in a string with thousands commas removed: "$1,234.5 million" gives ["1234.5"]. */
export function numberTokens(text: string): string[] {
  return (
    text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []
  ).map((token) => token.replace(/^0+(?=\d)/, ''));
}

export interface Verification {
  found: boolean;
  /** A short stretch of the page around the match, for the person to read. Empty when not found. */
  excerpt: string;
}

const EXCERPT_RADIUS = 110;
/** How far from the figure a word of the claim's name may sit. */
const CONTEXT_RADIUS = 400;
const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'total',
  'were',
  'was',
]);

const keywords = (label: string) =>
  [...new Set(normalize(label).match(/[a-z]{4,}/g) ?? [])].filter(
    (w) => !STOP.has(w),
  );

/**
 * Does the page contain what the person says it contains?
 * - A figure with numbers: every number must appear on the page, and at least
 *   one place where the first number appears must sit near a word from the
 *   claim's name (when the name has any), so a stray "6" elsewhere on the page
 *   does not count.
 * - A claim with no numbers: the whole phrase must appear.
 * This shows the figure is on the page. It cannot show the page means what the
 * person says, so the person still reads the excerpt.
 */
export function verifyFigure(
  valueText: string,
  pageText: string,
  label = '',
): Verification {
  const clean = pageText.replace(/\s+/g, ' ').trim();
  const page = normalize(clean);
  const wanted = numberTokens(valueText);

  if (wanted.length === 0) {
    const phrase = normalize(valueText).trim();
    if (phrase.length < 4) return { found: false, excerpt: '' };
    const at = page.indexOf(phrase);
    return at < 0
      ? { found: false, excerpt: '' }
      : { found: true, excerpt: excerptAround(clean, at, phrase.length) };
  }

  const present = new Set(numberTokens(page));
  for (const token of wanted)
    if (!present.has(token)) return { found: false, excerpt: '' };

  // Find each place the first number stands alone, allowing thousands commas on the page.
  const first = wanted[0];
  const digits = first.split('.')[0];
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',?');
  const decimals = first.includes('.') ? `\\.${first.split('.')[1]}` : '';
  const pattern = new RegExp(`(?<![\\d.,])${grouped}${decimals}(?![\\d])`, 'g');
  const words = keywords(label);
  let firstHit: { at: number; len: number } | null = null;
  for (const match of page.matchAll(pattern)) {
    const at = match.index ?? 0;
    firstHit ??= { at, len: match[0].length };
    if (words.length === 0) break;
    const near = page.slice(
      Math.max(0, at - CONTEXT_RADIUS),
      at + CONTEXT_RADIUS,
    );
    if (words.some((w) => near.includes(w)))
      return {
        found: true,
        excerpt: excerptAround(clean, at, match[0].length),
      };
  }
  if (!firstHit) return { found: false, excerpt: '' };
  return words.length === 0
    ? { found: true, excerpt: excerptAround(clean, firstHit.at, firstHit.len) }
    : { found: false, excerpt: '' };
}

function excerptAround(clean: string, at: number, length: number): string {
  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(clean.length, at + length + EXCERPT_RADIUS);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}
