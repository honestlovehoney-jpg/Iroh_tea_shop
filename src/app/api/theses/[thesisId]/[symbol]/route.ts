import { NextResponse } from 'next/server';
import { loadTickerDetail } from '@/thesis/bitget-deck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store' };

type RouteContext = { params: Promise<{ thesisId: string; symbol: string }> };

/** Candle and quote evidence for one stock in one thesis. */
export async function GET(_request: Request, context: RouteContext) {
  const { thesisId, symbol } = await context.params;
  try {
    const detail = await loadTickerDetail(thesisId, symbol);
    if (!detail)
      return NextResponse.json(
        { error: 'Unknown thesis or symbol.' },
        { status: 404, headers },
      );
    return NextResponse.json(detail, { headers });
  } catch {
    return NextResponse.json(
      { error: 'Bitget data is unavailable right now.' },
      { status: 502, headers },
    );
  }
}
