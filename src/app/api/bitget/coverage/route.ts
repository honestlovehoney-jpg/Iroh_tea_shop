import { NextResponse } from 'next/server';
import { db } from '@/auth/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SIGNAL_TYPES = new Set(['candles']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const signalType = url.searchParams.get('signalType') ?? 'candles';
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('pageSize') ?? 25);

  if (!ALLOWED_SIGNAL_TYPES.has(signalType)) {
    return NextResponse.json(
      {
        error: 'Unsupported or unverified signalType.',
        allowed: Array.from(ALLOWED_SIGNAL_TYPES),
      },
      { status: 400 },
    );
  }
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    return NextResponse.json(
      { error: 'Invalid pagination parameters.' },
      { status: 400 },
    );
  }

  try {
    const catalogSize = await db.bitgetAsset.count();
    const coverageRows = await db.bitgetSignalCoverage.findMany({
      where: { signalType },
      select: {
        instrumentId: true,
        status: true,
        lastAttemptedAt: true,
        lastSucceededAt: true,
        source: true,
        errorCode: true,
        errorMessage: true,
      },
    });

    const countsByStatus: Record<string, number> = {
      available: 0,
      unsupported: 0,
      unavailable: 0,
      stale: 0,
      error: 0,
    };
    for (const row of coverageRows) {
      if (row.status in countsByStatus) countsByStatus[row.status] += 1;
    }

    const coveredCount = coverageRows.length;
    const unverifiedCount = Math.max(0, catalogSize - coveredCount);
    const coveragePercentage =
      catalogSize === 0
        ? 0
        : Math.round((coveredCount / catalogSize) * 10000) / 100;

    const sample = coverageRows
      .sort(
        (a: any, b: any) =>
          b.lastAttemptedAt.getTime() - a.lastAttemptedAt.getTime(),
      )
      .slice((page - 1) * pageSize, page * pageSize)
      .map((row: any) => ({
        instrumentId: row.instrumentId,
        signalType,
        status: row.status,
        lastAttemptedAt: row.lastAttemptedAt.toISOString(),
        lastSucceededAt: row.lastSucceededAt
          ? row.lastSucceededAt.toISOString()
          : null,
        source: row.source,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
      }));

    return NextResponse.json({
      signalType,
      catalogSize,
      coveredCount,
      unverifiedCount,
      countsByStatus,
      coveragePercentage,
      page,
      pageSize,
      sample,
    });
  } catch {
    return NextResponse.json(
      { error: 'Coverage statistics are temporarily unavailable.' },
      { status: 503 },
    );
  }
}
