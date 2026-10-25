import { describe, expect, it } from 'vitest';
import { htmlToText, numberTokens, verifyFigure } from '../src/thesis/source-verify';

const filler = ' lorem ipsum dolor '.repeat(60);
const page = htmlToText(
  '<html><script>var x=999;</script><p>Total net sales were <b>$416,161</b> million in fiscal 2025.</p>' +
    filler +
    '<p>Headcount grew 6% overall.</p><p>Services &amp; other: 109,158</p></html>',
);

describe('htmlToText', () => {
  it('drops scripts and tags and decodes entities', () => {
    expect(page).toContain('Services & other: 109,158');
    expect(page.includes('999')).toBe(false);
    expect(page.includes('<')).toBe(false);
  });
});

describe('numberTokens', () => {
  it('removes thousands commas and keeps decimals', () => {
    expect(numberTokens('$416,161 million')).toEqual(['416161']);
    expect(numberTokens('12.4 billion and 3')).toEqual(['12.4', '3']);
  });
});

describe('verifyFigure', () => {
  it('finds a figure near the words of its claim and returns an excerpt', () => {
    const result = verifyFigure('$416,161 million', page, 'Apple net sales');
    expect(result.found).toBe(true);
    expect(result.excerpt).toContain('416,161');
  });

  it('does not accept a number that appears only near unrelated words', () => {
    expect(verifyFigure('6%', page, 'net sales growth').found).toBe(false);
    expect(verifyFigure('6%', page, 'headcount').found).toBe(true);
  });

  it('does not accept a number that is a prefix of a different one', () => {
    expect(verifyFigure('$12.4 billion', 'sales were 12.45 billion', 'sales').found).toBe(false);
    expect(verifyFigure('109', page, 'services').found).toBe(false);
  });

  it('refuses a figure that is not on the page, and matches a number-free phrase', () => {
    expect(verifyFigure('$500 million', page, 'net sales').found).toBe(false);
    expect(verifyFigure('net sales were', page, 'x').found).toBe(true);
    expect(verifyFigure('ab', page, 'x').found).toBe(false);
  });
});
