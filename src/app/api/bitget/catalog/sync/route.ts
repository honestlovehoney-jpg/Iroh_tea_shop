import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { syncBitgetCatalog } from '@/services/bitget/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = process.env.BITGET_CATALOG_SYNC_TOKEN;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const result = await syncBitgetCatalog();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Catalog sync failed.';
    return NextResponse.json({ error: 'Catalog sync failed.', detail: message }, { status: 502 });
  }
}
