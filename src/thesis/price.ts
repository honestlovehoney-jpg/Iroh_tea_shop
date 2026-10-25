import 'server-only';
import { getCandles } from '@/services/bitget/candles';

export interface LastPrice {
  price: number;
  /** Timestamp of the candle the price comes from. */
  asOf: string;
}

/** The latest Bitget hourly close for an instrument, or null when Bitget has nothing usable. */
export async function lastPrice(
  instrumentId: string,
): Promise<LastPrice | null> {
  try {
    const signal = await getCandles({
      instrumentId,
      granularity: '1hour',
      limit: 3,
    });
    const rows = signal.value;
    if (!rows?.length) return null;
    const latest = rows.reduce((a, b) =>
      Date.parse(b.timestamp) > Date.parse(a.timestamp) ? b : a,
    );
    if (!Number.isFinite(latest.close) || latest.close <= 0) return null;
    return { price: latest.close, asOf: latest.timestamp };
  } catch {
    return null;
  }
}

export interface DailyClose {
  timestamp: string;
  close: number;
}

/** Up to 30 daily Bitget closes for an instrument, or null when Bitget has none. */
export async function dailyCloses(
  instrumentId: string,
): Promise<DailyClose[] | null> {
  try {
    const signal = await getCandles({
      instrumentId,
      granularity: '1day',
      limit: 30,
    });
    if (!signal.value?.length) return null;
    return signal.value.map((c) => ({
      timestamp: c.timestamp,
      close: c.close,
    }));
  } catch {
    return null;
  }
}

/** Up to 100 daily Bitget candles, oldest first. The newest may still be forming. */
export async function dailyCandles100(
  instrumentId: string,
): Promise<DailyClose[] | null> {
  try {
    const signal = await getCandles({
      instrumentId,
      granularity: '1day',
      limit: 100,
    });
    if (!signal.value?.length) return null;
    return [...signal.value]
      .map((c) => ({ timestamp: c.timestamp, close: c.close }))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  } catch {
    return null;
  }
}
