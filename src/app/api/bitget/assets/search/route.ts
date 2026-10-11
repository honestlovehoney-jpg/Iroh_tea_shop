import { NextResponse } from 'next/server';
import { searchBitgetAssets } from '@/services/bitget/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('pageSize') ?? 25);
  if (query.length > 120 || !Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: 'Invalid search parameters.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await searchBitgetAssets({ query, page, pageSize }));
  } catch {
    return NextResponse.json({ error: 'Asset search is temporarily unavailable.' }, { status: 503 });
  }
}
