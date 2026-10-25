import { NextRequest, NextResponse } from 'next/server';
import { syncDiscoveredPoisToDb } from '@/lib/toiletSync';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const scanCenter =
      body?.scanCenter &&
      Number.isFinite(Number(body.scanCenter.lng)) &&
      Number.isFinite(Number(body.scanCenter.lat))
        ? {
            lng: Number(body.scanCenter.lng),
            lat: Number(body.scanCenter.lat),
            force: Boolean(body.scanCenter.force),
          }
        : null;

    const result = syncDiscoveredPoisToDb({
      pois: body?.pois,
      inferredVenues: body?.inferredVenues,
      fullScan: Boolean(body?.fullScan),
      scanCenter,
    });

    return NextResponse.json({
      code: 200,
      data: result,
    });
  } catch (error) {
    console.error('[POST /api/v1/toilets/sync error]', error);
    return NextResponse.json(
      { code: 500, message: '同步POI失败' },
      { status: 500 }
    );
  }
}
