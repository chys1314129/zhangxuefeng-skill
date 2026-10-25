import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import {
  locateByIpServer,
  reverseGeocodeServer,
  syncAreaToiletsSharedServer,
  syncInferredVenuesSharedServer,
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
  const force = searchParams.get('force') === 'true';
  const authUser = force ? await getAuthUser(request) : null;
  const isAdmin =
    authUser?.role === 'ADMIN' || authUser?.role === 'SUPER_ADMIN';

  if (mode === 'inferred') {
    const stats = await syncInferredVenuesSharedServer({
      lng,
      lat,
      radius,
      force,
      isAdmin,
    });
    return NextResponse.json({ code: 200, data: stats });
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

  const stats = await syncAreaToiletsSharedServer({
    lng,
    lat,
    radius,
    bounds,
    force,
    isAdmin,
  });

  return NextResponse.json({ code: 200, data: stats });
}
