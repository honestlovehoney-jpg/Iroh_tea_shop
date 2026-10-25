import { findThesis } from '@/thesis/deck';
import type { DeckSnapshot, Thesis } from '@/thesis/types';

export type DeckLoader = () => Promise<DeckSnapshot>;

const LOAD_TIMEOUT_MS = 4_000;

/** The thesis the trader opened on the desk, resolved on the server from its id. */
export async function loadThesisContext(
  thesisId: unknown,
  load: DeckLoader,
): Promise<{ thesis: Thesis; block: string } | null> {
  if (typeof thesisId !== 'string') return null;
  const thesis = findThesis(thesisId);
  if (!thesis) return null;

  let momentum = 'not available right now';
  try {
    const snapshot = await Promise.race([
      load(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS),
      ),
    ]);
    const conviction = snapshot.theses.find((item) => item.id === thesis.id)
      ?.conviction;
    if (conviction && conviction.level !== 'unknown') {
      const avg =
        conviction.avgChangePct === null
          ? ''
          : `, average price change ${conviction.avgChangePct.toFixed(2)} percent`;
      momentum = `${conviction.level}, ${conviction.rising} of ${conviction.measured} stocks rose over the candle window${avg}`;
    }
  } catch {
    // The thesis text still helps without the momentum reading.
  }

  const stocks = thesis.tickers.map((t) => `${t.symbol} (${t.name})`).join(', ');
  const block = `Thesis open on the desk: "${thesis.title}", ${thesis.subtitle}.
Thesis text: ${thesis.body}
Stocks in this thesis: ${stocks}
Price momentum reading: ${momentum}. This is price data only and does not say the thesis is right.`;
  return { thesis, block };
}
