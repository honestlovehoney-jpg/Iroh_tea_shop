import type { Thesis, ThesisId } from './types';

/**
 * Three research theses for Bitget Reality tokenized US stocks.
 * `symbol` is the underlying ticker (e.g. AAPL). Canonical Bitget instrument
 * IDs follow the Reality pattern (e.g. RAAPLUSDT) and are resolved via catalog.
 * Thesis ids stay stable so existing artwork paths keep working.
 */
export const THESES: Thesis[] = [
  {
    id: 'robinhood',
    numeral: 'I',
    title: 'Mega-Cap Tokenization',
    subtitle: 'The household names on Bitget Reality',
    body: 'Apple, Microsoft, NVIDIA, and Amazon are among the most watched tokenized US equities. This thesis tracks whether Bitget Reality coverage and price evidence stay available for the largest names as the catalog evolves.',
    spirit: 'Jade Fortune Toad',
    image: '/images/theses/robinhood.webp',
    hue: 145,
    colors: { primary: '#2f7d5b', accent: '#b8d8a8', ink: '#15342a' },
    tickers: [
      { symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'stock' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', assetClass: 'stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', assetClass: 'stock' },
      { symbol: 'AMZN', name: 'Amazon.com, Inc.', assetClass: 'stock' },
    ],
  },
  {
    id: 'bullrun',
    numeral: 'II',
    title: 'Growth & Consumer',
    subtitle: 'Demand-cycle names on Reality rails',
    body: 'Tesla, Meta, Netflix, and Costco span consumer demand, platforms, and discretionary spend. This thesis organizes Bitget Reality instruments so you can compare coverage and candle evidence across growth-oriented names.',
    spirit: 'Golden Ox',
    image: '/images/theses/bullrun.webp',
    hue: 38,
    colors: { primary: '#b8862f', accent: '#e7c77a', ink: '#3b2410' },
    tickers: [
      { symbol: 'TSLA', name: 'Tesla, Inc.', assetClass: 'stock' },
      { symbol: 'META', name: 'Meta Platforms, Inc.', assetClass: 'stock' },
      { symbol: 'NFLX', name: 'Netflix, Inc.', assetClass: 'stock' },
      { symbol: 'COST', name: 'Costco Wholesale Corporation', assetClass: 'stock' },
    ],
  },
  {
    id: 'ai',
    numeral: 'III',
    title: 'Financials & Benchmarks',
    subtitle: 'Banks, payments, and the index proxy',
    body: 'JPMorgan, Visa, Goldman Sachs, and the S&P 500 ETF give a cross-section of financial infrastructure and broad market exposure. Use this thesis to inspect which Reality instruments have verified candle coverage today.',
    spirit: 'Iron Crane',
    image: '/images/theses/ai.webp',
    hue: 210,
    colors: { primary: '#2a5f8f', accent: '#9ec5e8', ink: '#102536' },
    tickers: [
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', assetClass: 'stock' },
      { symbol: 'V', name: 'Visa Inc.', assetClass: 'stock' },
      { symbol: 'GS', name: 'Goldman Sachs Group, Inc.', assetClass: 'stock' },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', assetClass: 'stock' },
    ],
  },
];

export function findThesis(id: string): Thesis | undefined {
  return THESES.find((thesis) => thesis.id === id);
}

export function findTicker(thesisId: ThesisId | string, symbol: string) {
  return findThesis(thesisId)?.tickers.find(
    (ticker) => ticker.symbol === symbol.toUpperCase(),
  );
}

/** Map underlying ticker → likely Bitget Reality instrument id (convention). */
export function realityInstrumentId(underlyingTicker: string): string {
  return `R${underlyingTicker.toUpperCase()}USDT`;
}
