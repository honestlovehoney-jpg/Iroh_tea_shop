import { NextResponse } from 'next/server';
import { BitgetApiError } from '@/services/bitget/client';
import { getCandles } from '@/services/bitget/candles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ instrumentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { instrumentId } = await context.params;
  const url = new URL(request.url);
  const granularity = url.searchParams.get('granularity') ?? '1day';
  const limit = Number(url.searchParams.get('limit') ?? 3);
  if (!instrumentId || instrumentId.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: 'Invalid candle parameters.' }, { status: 400 });
  }
  try {
    const result = await getCandles({ instrumentId, granularity, limit });
    return NextResponse.json(result, { status: result.status === 'error' ? 502 : 200 });
  } catch (error) {
    if (error instanceof BitgetApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status === 502 ? 502 : error.status });
    }
    return NextResponse.json({ error: 'Candle retrieval is temporarily unavailable.' }, { status: 503 });
  }
}
