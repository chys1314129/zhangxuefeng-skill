import { NextRequest, NextResponse } from 'next/server';
import {
  batchWalkingDistanceServer,
  planShortestWalkingRouteServer,
} from '@/lib/amap-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fromLng = parseFloat(searchParams.get('fromLng') || '');
  const fromLat = parseFloat(searchParams.get('fromLat') || '');
  const toLng = parseFloat(searchParams.get('toLng') || '');
  const toLat = parseFloat(searchParams.get('toLat') || '');

  if (
    !Number.isFinite(fromLng) ||
    !Number.isFinite(fromLat) ||
    !Number.isFinite(toLng) ||
    !Number.isFinite(toLat)
  ) {
    return NextResponse.json(
      { code: 400, message: '起终点坐标无效' },
      { status: 400 }
    );
  }

  const route = await planShortestWalkingRouteServer({
    fromLng,
    fromLat,
    toLng,
    toLat,
  });

  return NextResponse.json({
    code: 200,
    data: { route },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userLng = Number(body?.userLng);
    const userLat = Number(body?.userLat);
    const rawTargets = Array.isArray(body?.targets) ? body.targets : [];

    if (!Number.isFinite(userLng) || !Number.isFinite(userLat)) {
      return NextResponse.json(
        { code: 400, message: '用户坐标无效' },
        { status: 400 }
      );
    }

    const targets = rawTargets
      .slice(0, 100)
      .map((t: any) => ({
        id: String(t?.id || ''),
        lng: Number(t?.lng),
        lat: Number(t?.lat),
      }))
      .filter(
        (t: { id: string; lng: number; lat: number }) =>
          t.id && Number.isFinite(t.lng) && Number.isFinite(t.lat)
      );

    const results = await batchWalkingDistanceServer({
      userLng,
      userLat,
      targets,
    });

    return NextResponse.json({
      code: 200,
      data: { results },
    });
  } catch {
    return NextResponse.json(
      { code: 500, message: '路径距离测算失败' },
      { status: 500 }
    );
  }
}
