import { NextResponse } from 'next/server';
import { db } from '@/auth/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const theses = await db.thesis.findMany({
      orderBy: { createdAt: 'desc' },
      // Only include instrument if it exists, avoid relation crashes
      select: {
        id: true,
        title: true,
        content: true,
        instrumentId: true,
        createdAt: true,
        updatedAt: true,
      }
    });
    return NextResponse.json(theses);
  } catch (error: any) {
    console.error('[Theses GET Error]:', error);
    return NextResponse.json({ error: 'Failed to fetch theses', details: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, content, instrumentId } = body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'Valid title is required' }, { status: 400 });
    }

    const thesis = await db.thesis.create({
      data: {
        title: title.trim(),
        content: content?.trim() || null,
        instrumentId: instrumentId || null,
      },
      select: {
        id: true,
        title: true,
        content: true,
        instrumentId: true,
        createdAt: true,
      }
    });

    return NextResponse.json(thesis, { status: 201 });
  } catch (error: any) {
    console.error('[Theses POST Error]:', error);
    return NextResponse.json({ error: 'Failed to create thesis', details: error.message }, { status: 500 });
  }
}
