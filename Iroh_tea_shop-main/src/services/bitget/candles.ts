import 'server-only';
import { db } from '@/auth/db';
import { BitgetApiError, fetchSpotCandles } from './client';
import type { NormalizedCandle, NormalizedSignal, SignalStatus } from './types';
import { normalizeCandleRows } from './candle-normalizer';
export { normalizeCandleRows } from './candle-normalizer';

const CACHE_TTL_MS = 60_000;
const ALLOWED_GRANULARITIES = new Set([
  '1min', '5min', '15min', '30min', '1hour', '4hour', '6hour', '12hour', '1day', '1week', '1M',
]);

async function recordCoverage(input: {
  instrumentId: string;
  signalType: string;
  status: SignalStatus;
  now: Date;
  source?: string;
  errorCode?: string;
  errorMessage?: string;
  succeeded?: boolean;
}): Promise<void> {
  try {
    const existing = await db.bitgetSignalCoverage.findUnique({
      where: { instrumentId_signalType: { instrumentId: input.instrumentId, signalType: input.signalType } },
    });
    const lastSucceededAt = input.succeeded ? input.now : (existing?.lastSucceededAt ?? null);

    await db.bitgetSignalCoverage.upsert({
      where: { instrumentId_signalType: { instrumentId: input.instrumentId, signalType: input.signalType } },
      create: {
        instrumentId: input.instrumentId, signalType: input.signalType, status: input.status,
        lastAttemptedAt: input.now, lastSucceededAt, source: input.source ?? 'bitget',
        errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null,
      },
      update: {
        status: input.status, lastAttemptedAt: input.now, lastSucceededAt,
        source: input.source ?? 'bitget', errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null,
      },
    });
  } catch (persistenceError) {
    console.error('[bitget] coverage persistence failed', { instrumentId: input.instrumentId, signalType: input.signalType, error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError) });
  }
}

export async function getCandles(input: { instrumentId: string; granularity?: string; limit?: number; now?: Date }): Promise<NormalizedSignal<NormalizedCandle[]>> {
  const now = input.now ?? new Date();
  const granularity = input.granularity ?? '1day';
  if (!ALLOWED_GRANULARITIES.has(granularity)) throw new BitgetApiError('Unsupported candle granularity', 'INVALID_GRANULARITY', 400);
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 3)));
  
  const asset = await db.bitgetAsset.findUnique({ where: { providerInstrumentId: input.instrumentId } });
  if (!asset) throw new BitgetApiError('Unknown canonical instrument ID', 'INSTRUMENT_NOT_FOUND', 404);

  const cacheKey = `${asset.providerInstrumentId}:candles:${granularity}:${limit}`;
  const cached = await db.bitgetSignalObservation.findUnique({ where: { cacheKey } });

  if (cached && now.getTime() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return JSON.parse(cached.payload) as NormalizedSignal<NormalizedCandle[]>;
  }

  const fetchedAt = now.toISOString();
  try {
    const response = await fetchSpotCandles({ symbol: asset.symbol, granularity, limit });
    const value = normalizeCandleRows(response.rows);
    const observedAt = value.length ? value[0].timestamp : null;
    const status: SignalStatus = value.length ? 'available' : 'unavailable';
    const result: NormalizedSignal<NormalizedCandle[]> = {
      instrumentId: asset.providerInstrumentId, signalType: 'candles', status,
      value: value.length ? value : null, source: 'bitget', observedAt, fetchedAt,
      expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(), stale: false,
      ...(value.length ? {} : { errorCode: 'NO_CANDLE_DATA', errorMessage: 'No candles were returned for this instrument and interval.' }),
    };

    await db.bitgetSignalObservation.upsert({
      where: { cacheKey },
      create: { cacheKey, instrumentId: asset.providerInstrumentId, signalType: 'candles', payload: JSON.stringify(result), fetchedAt: now },
      update: { payload: JSON.stringify(result), fetchedAt: now },
    });

    await recordCoverage({ instrumentId: asset.providerInstrumentId, signalType: 'candles', status, now, source: 'bitget', succeeded: value.length > 0, errorCode: value.length ? undefined : 'NO_CANDLE_DATA', errorMessage: value.length ? undefined : 'No candles were returned for this instrument and interval.' });
    return result;
  } catch (error) {
    if (!(error instanceof BitgetApiError)) throw error;
    if (cached) {
      try {
        const previous = JSON.parse(cached.payload) as NormalizedSignal<NormalizedCandle[]>;
        if (previous && previous.instrumentId === asset.providerInstrumentId && previous.value) {
          await recordCoverage({ instrumentId: asset.providerInstrumentId, signalType: 'candles', status: 'stale', now, source: 'bitget', succeeded: false, errorCode: error.code, errorMessage: `Refresh failed: ${error.message}` });
          return { ...previous, status: 'stale', stale: true, expiresAt: new Date(cached.fetchedAt.getTime() + CACHE_TTL_MS).toISOString(), errorCode: error.code, errorMessage: `Showing the last cached observation because refresh failed: ${error.message}` };
        }
      } catch { /* ignore corrupt cache */ }
    }
    await recordCoverage({ instrumentId: asset.providerInstrumentId, signalType: 'candles', status: 'error', now, source: 'bitget', succeeded: false, errorCode: error.code, errorMessage: error.message });
    return { instrumentId: asset.providerInstrumentId, signalType: 'candles', status: 'error', value: null, source: 'bitget', observedAt: null, fetchedAt, expiresAt: fetchedAt, stale: false, errorCode: error.code, errorMessage: error.message };
  }
}
