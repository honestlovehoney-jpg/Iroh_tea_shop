import { NextResponse } from 'next/server';
import { getEquityData } from '@/services/bitget/mcp-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const entryId = searchParams.get('entryId');
  const symbol = searchParams.get('symbol');

  if (!entryId || !symbol) {
    return NextResponse.json(
      { error: 'Missing entryId or symbol' },
      { status: 400 },
    );
  }

  try {
    // Provenance tracking
    const data = await getEquityData(entryId, { symbol });

    return NextResponse.json({
      source: 'bitget_mcp',
      entryId,
      symbol,
      timestamp: new Date().toISOString(),
      data: typeof data === 'string' ? JSON.parse(data) : data,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
