import { NextRequest, NextResponse } from 'next/server';
import {
  locateByIpServer,
  reverseGeocodeServer,
  searchAroundToiletsServer,
  searchInferredVenuesServer,
} from '@/lib/amap-server';
import type { MapBounds } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'around';

  if (mode === 'ip') {
    const forwarded =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      '';
    const ipLoc = await locateByIpServer(forwarded);
    return NextResponse.json({ code: 200, data: { location: ipLoc } });
  }

  const lng = parseFloat(searchParams.get('lng') || '');
  const lat = parseFloat(searchParams.get('lat') || '');

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json(
      { code: 400, message: '坐标参数无效' },
      { status: 400 }
    );
  }

  if (mode === 'regeo') {
    const address = await reverseGeocodeServer(lng, lat);
    return NextResponse.json({ code: 200, data: { address } });
  }

  const radius = parseInt(searchParams.get('radius') || '3000', 10);

  if (mode === 'inferred') {
    const venues = await searchInferredVenuesServer({ lng, lat, radius });
    return NextResponse.json({ code: 200, data: { venues } });
  }

  const minLng = parseFloat(searchParams.get('minLng') || '');
  const minLat = parseFloat(searchParams.get('minLat') || '');
  const maxLng = parseFloat(searchParams.get('maxLng') || '');
  const maxLat = parseFloat(searchParams.get('maxLat') || '');

  const bounds: MapBounds | null =
    Number.isFinite(minLng) &&
    Number.isFinite(minLat) &&
    Number.isFinite(maxLng) &&
    Number.isFinite(maxLat)
      ? { minLng, minLat, maxLng, maxLat }
      : null;

  const pois = await searchAroundToiletsServer({ lng, lat, radius, bounds });
  return NextResponse.json({ code: 200, data: { pois } });
}
