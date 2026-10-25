import { NextRequest, NextResponse } from 'next/server';
import { searchPlaceServer } from '@/lib/amap-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('keyword') || '';
  const lng = parseFloat(searchParams.get('lng') || '');
  const lat = parseFloat(searchParams.get('lat') || '');

  const places = await searchPlaceServer(
    keyword,
    Number.isFinite(lng) ? lng : undefined,
    Number.isFinite(lat) ? lat : undefined
  );
  return NextResponse.json({ code: 200, data: { places } });
}
