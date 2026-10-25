import { Fragment, type CSSProperties } from 'react';
import type { Station } from '../shared/contracts';

export const STATION_TEASERS: Partial<
  Record<Station, { glyph: string; text: string; cta?: [string, string] }>
> = {
  Counter: {
    glyph: '签',
    text: 'Choose a stock thesis. Inspect Bitget Reality evidence.',
    cta: ['Open the', 'Thesis Desk'],
  },
  AvatarSeat: {
    glyph: '师',
    text: 'Ask Uncle about a stock. He reads Bitget data and explains it.',
    cta: ['Ask', 'Uncle'],
  },
  Shelf: {
    glyph: '卷',
    text: 'See how much of the Bitget catalog has verified price candles.',
    cta: ['See the', 'market coverage'],
  },
  TeaTable: {
    glyph: '星',
    text: 'See how the S&P 500 and the largest US stocks are moving.',
    cta: ['Open the', 'market board'],
  },
};

/** Decorative ink-typed line. Always pair it with a readable copy for assistive tech. */
export function InkLine({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  let index = 0;
  return (
    <span className={`ink-line ${className}`} aria-hidden="true">
      {text.split(' ').map((word, w) => (
        <Fragment key={w}>
          {w > 0 && ' '}
          <span className="ink-word">
            {Array.from(word).map((char, c) => (
              <span key={c} style={{ '--i': index++ } as CSSProperties}>
                {char}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
