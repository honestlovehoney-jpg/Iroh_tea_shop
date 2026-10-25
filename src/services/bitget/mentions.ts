/** Finds catalog instruments that a question mentions, by ticker or company name. Pure, no I/O. */

export type CatalogEntry = {
  underlyingTicker: string | null;
  companyName: string | null;
};

export type Mention = { ticker: string; companyName: string | null };

const COMMON_WORDS = new Set(
  (
    'all and any are but can did for get has her him his how its let may new not now off old one our out ' +
    'own put say see she the too two use was way who why yes you buy sell hold more most much many some ' +
    'than that them then they this what when will with your from into over also just like make best good ' +
    'high low big run win key fit man top end low earn pay cash plan next real true true gain loss risk ' +
    'rate play beat fast slow open close long short move well work year week day time test thesis price ' +
    'stock stocks share shares first last back down after before about above below against between'
  ).split(' '),
);

const NAME_NOISE = new Set(
  (
    'inc corp corporation co company ltd limited plc holdings holding group the class ordinary ' +
    'shares share common stock adr ads trust fund etf sa nv ag lp llc'
  ).split(' '),
);

const WEAK_FIRST_WORDS = new Set(
  'first united global american national general international new bank capital energy health financial'.split(
    ' ',
  ),
);

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !NAME_NOISE.has(word))
    .join(' ');
}

export function findMentions(
  question: string,
  catalog: CatalogEntry[],
  max = 4,
): Mention[] {
  const byTicker = new Map<string, Mention>();
  const byName = new Map<string, Mention>();
  const firstWordCounts = new Map<string, number>();
  const firstWordOwner = new Map<string, Mention>();

  for (const entry of catalog) {
    const ticker = entry.underlyingTicker?.trim().toUpperCase();
    if (!ticker) continue;
    const mention = { ticker, companyName: entry.companyName };
    if (!byTicker.has(ticker)) byTicker.set(ticker, mention);
    const normalized = entry.companyName
      ? normalizeName(entry.companyName)
      : '';
    if (normalized.length >= 4) {
      byName.set(normalized, mention);
      const first = normalized.split(' ')[0];
      if (first.length >= 5 && !WEAK_FIRST_WORDS.has(first)) {
        firstWordCounts.set(first, (firstWordCounts.get(first) ?? 0) + 1);
        firstWordOwner.set(first, mention);
      }
    }
  }

  const found: Array<{ at: number; mention: Mention }> = [];
  const seen = new Set<string>();
  const add = (at: number, mention: Mention | undefined) => {
    if (!mention || seen.has(mention.ticker)) return;
    seen.add(mention.ticker);
    found.push({ at, mention });
  };

  // Tickers: typed in capitals, they always count. Lowercase counts unless it is a common word.
  const tokenPattern = /[A-Za-z][A-Za-z.]{0,5}/g;
  for (const match of question.matchAll(tokenPattern)) {
    const token = match[0];
    const at = match.index ?? 0;
    const upper = token.toUpperCase();
    const typedUpper = token === upper && token.length >= 2;
    if (!byTicker.has(upper)) continue;
    if (typedUpper) {
      add(at, byTicker.get(upper));
    } else if (token.length >= 3 && !COMMON_WORDS.has(token.toLowerCase())) {
      add(at, byTicker.get(upper));
    }
  }

  // Company names: a full name as a phrase, or a distinctive first word that belongs to one company only.
  const lowered = ` ${question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  for (const [name, mention] of byName) {
    const at = lowered.indexOf(` ${name} `);
    if (at >= 0) add(at, mention);
  }
  for (const [first, count] of firstWordCounts) {
    if (count !== 1) continue;
    const at = lowered.indexOf(` ${first} `);
    if (at >= 0) add(at, firstWordOwner.get(first));
  }

  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map((item) => item.mention);
}

/** Crypto coins a question mentions, as spot base coins such as BTC. Pure, no I/O. */

const CRYPTO_NAMES: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  ether: 'ETH',
  solana: 'SOL',
  ripple: 'XRP',
  dogecoin: 'DOGE',
  cardano: 'ADA',
  litecoin: 'LTC',
  chainlink: 'LINK',
  avalanche: 'AVAX',
  polkadot: 'DOT',
  tron: 'TRX',
  toncoin: 'TON',
  shiba: 'SHIB',
  bnb: 'BNB',
  'bitget token': 'BGB',
  sui: 'SUI',
  pepe: 'PEPE',
  aptos: 'APT',
  arbitrum: 'ARB',
  cosmos: 'ATOM',
  uniswap: 'UNI',
  stellar: 'XLM',
};

/** Always crypto when typed in capitals, even if a stock shares the ticker. */
const MAJOR_COINS = new Set(
  'BTC ETH SOL XRP DOGE ADA BNB LTC AVAX DOT TRX TON BGB LINK SHIB SUI PEPE APT ARB ATOM UNI XLM'.split(
    ' ',
  ),
);

/** Safe to accept in lowercase, since none of these is an ordinary English word. */
const LOWERCASE_COINS = new Set(
  'btc eth sol xrp doge ada bnb ltc avax trx bgb shib pepe sui'.split(' '),
);

export function findCryptoMentions(
  question: string,
  spotBases: ReadonlySet<string>,
  stockTickers: ReadonlySet<string>,
  max = 3,
): string[] {
  const found: Array<{ at: number; base: string }> = [];
  const seen = new Set<string>();
  const known = (base: string) => spotBases.size === 0 || spotBases.has(base);
  const add = (at: number, base: string) => {
    if (seen.has(base) || !known(base)) return;
    seen.add(base);
    found.push({ at, base });
  };

  const lowered = ` ${question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  for (const [name, base] of Object.entries(CRYPTO_NAMES)) {
    const at = lowered.indexOf(` ${name} `);
    if (at >= 0) add(at, base);
  }

  for (const match of question.matchAll(/[A-Za-z][A-Za-z0-9]{1,9}/g)) {
    const token = match[0];
    const at = match.index ?? 0;
    const upper = token.toUpperCase();
    const typedUpper = token === upper;
    if (typedUpper) {
      if (MAJOR_COINS.has(upper)) add(at, upper);
      else if (spotBases.has(upper) && !stockTickers.has(upper)) add(at, upper);
    } else if (LOWERCASE_COINS.has(token)) {
      add(at, upper);
    }
  }

  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map((item) => item.base);
}
