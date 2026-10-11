import { NextResponse } from 'next/server';
import { CatalogEmptyError, loadMarketBoard } from '@/thesis/bitget-deck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store' };

/** Daily-candle moves for the benchmark and the largest US stocks. */
export async function GET() {
  try {
    return NextResponse.json(await loadMarketBoard(), { headers });
  } catch (error) {
    if (error instanceof CatalogEmptyError)
      return NextResponse.json(
        { error: error.message },
        { status: 503, headers },
      );
    return NextResponse.json(
      { error: 'Bitget data is unavailable right now.' },
      { status: 502, headers },
    );
  }
}
