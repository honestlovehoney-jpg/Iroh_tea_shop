// Source Lock for model answers: every figure in Uncle's reply must match a
// number in the Bitget evidence the reply was written from, or it is withheld.
// Pure functions with no imports, so the route and the tests share one rule.

export const WITHHELD = '[figure withheld]';

export interface LockResult {
  text: string;
  /** True when too few figures matched for the answer to be shown at all. */
  refused: boolean;
  /** Figures that looked like claims and were checked. */
  checked: number;
  verified: number;
  /** The figures that were removed, as written. */
  withheld: string[];
}

const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  trillion: 1e12,
};

/** Every number that appears anywhere in the evidence, as an absolute value. */
export function evidenceNumbers(evidence: unknown): number[] {
  const found: number[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || found.length > 50_000) return;
    if (typeof value === 'number' && Number.isFinite(value))
      found.push(Math.abs(value));
    else if (typeof value === 'string')
      for (const token of value
        .replace(/(\d),(?=\d{3}\b)/g, '$1')
        .match(/\d+(?:\.\d+)?/g) ?? [])
        found.push(Number(token));
    else if (Array.isArray(value))
      for (const item of value) visit(item, depth + 1);
    else if (value && typeof value === 'object')
      for (const item of Object.values(value)) visit(item, depth + 1);
  };
  visit(evidence, 0);
  return found;
}

const TOKEN =
  /(?<![\w.$])([-+\u2212]?)(\$?)(\d[\d,]*(?:\.\d+)?)(?:\s?(%|percent\b|percentage points?\b|pp\b|bps\b)|\s?(thousand|million|billion|trillion|bn|mm|[kmbt])\b)?/gi;

// A number followed by one of these is a count of time or items, not a market figure.
const COUNT_UNIT =
  /^[\s-]*(?:h|hr|hrs|hours?|days?|d|weeks?|wks?|months?|minutes?|mins?|years?|windows?|periods?|candles?|bullets?|words?|items?|x|st|nd|rd|th|in\s+\d+)\b/i;

function maskNonClaims(text: string): string {
  return text
    .replace(
      /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g,
      (m) => ' '.repeat(m.length),
    )
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, (m) => ' '.repeat(m.length))
    .replace(/\b\d+\s+in\s+\d+\b/gi, (m) => ' '.repeat(m.length));
}

interface Figure {
  raw: string;
  start: number;
  end: number;
  value: number;
  decimals: number;
  multiplier: number;
}

function extractFigures(text: string, allowed: Set<number>): Figure[] {
  const masked = maskNonClaims(text);
  const figures: Figure[] = [];
  for (const match of masked.matchAll(TOKEN)) {
    const [raw, , dollar, digits, percentWord, magnitude] = match;
    const start = match.index ?? 0;
    const clean = digits.replace(/,/g, '');
    const decimals = clean.includes('.') ? clean.split('.')[1].length : 0;
    const value = Number(clean);
    if (!Number.isFinite(value)) continue;
    const isMarket = Boolean(dollar || percentWord || magnitude);
    const after = masked.slice(start + raw.length);
    if (!isMarket && COUNT_UNIT.test(after)) continue;
    // Years and small whole numbers in prose are not market claims.
    if (!isMarket && decimals === 0 && value >= 1900 && value <= 2100) continue;
    if (!isMarket && decimals === 0 && value < 100) continue;
    // A figure the person typed in their own question is theirs, not a claim.
    if (allowed.has(Number(clean))) continue;
    const multiplier = magnitude
      ? (MULTIPLIER[magnitude.toLowerCase()] ?? 1)
      : 1;
    figures.push({
      raw: raw.trim(),
      start,
      end: start + raw.length,
      value,
      decimals,
      multiplier,
    });
  }
  return figures;
}

/** Does any evidence number round to this figure at the precision it was written? */
function supported(figure: Figure, evidence: number[]): boolean {
  const scaled = figure.value * figure.multiplier;
  const tolerance = 0.5 * 10 ** -figure.decimals * figure.multiplier;
  const epsilon = tolerance * 1e-9 + 1e-12;
  return evidence.some((e) => Math.abs(e - scaled) <= tolerance + epsilon);
}

/**
 * Check the figures in an answer against the evidence. Unsupported figures are
 * replaced with a marker. When most figures fail, or there is no evidence to
 * check against, the whole answer is refused.
 *
 * Limits: this matches numbers, not meaning. A figure that matches some other
 * number in the evidence still passes. It cannot check words such as
 * "rising", and it ignores years, small whole numbers and counts of days.
 */
export function lockAnswer(
  answer: string,
  evidence: unknown,
  userQuestion = '',
): LockResult {
  const numbers = evidenceNumbers(evidence);
  const fromQuestion = new Set(
    (
      userQuestion.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ??
      []
    ).map(Number),
  );
  const figures = extractFigures(answer, fromQuestion);
  const withheldFigures = figures.filter((f) => !supported(f, numbers));
  const checked = figures.length;
  const verified = checked - withheldFigures.length;

  const refused =
    checked > 0 &&
    (numbers.length === 0 ||
      (checked >= 3 && withheldFigures.length / checked >= 0.5));
  if (refused)
    return {
      text: 'Source Lock refused this answer: most of its figures could not be matched to the Bitget evidence it was written from. Ask again, or read the prices on the Observatorium.',
      refused: true,
      checked,
      verified,
      withheld: withheldFigures.map((f) => f.raw),
    };

  let text = answer;
  // Replace from the end so earlier offsets stay valid. Offsets index the masked copy, which has the same length.
  for (const f of [...withheldFigures].sort((a, b) => b.start - a.start))
    text = text.slice(0, f.start) + WITHHELD + text.slice(f.end);
  return {
    text,
    refused: false,
    checked,
    verified,
    withheld: withheldFigures.map((f) => f.raw),
  };
}
