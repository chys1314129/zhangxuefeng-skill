import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSystemAdminId } from '@/lib/db';
import { getBoundingBox, haversineDistance } from '@/lib/geo';
import { generateId } from '@/lib/utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pois = Array.isArray(body?.pois) ? body.pois.slice(0, 40) : [];

    if (pois.length === 0) {
      return NextResponse.json({ code: 200, data: { synced: 0 } });
    }

    const db = getDb();
    const systemOwnerId = getSystemAdminId();
    const now = new Date().toISOString();
    let synced = 0;

    const findByAmapId = db.prepare('SELECT id FROM toilets WHERE amap_id = ?');
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO toilets (
        id, name, lng, lat, address, source, status, amap_id,
        is_free, has_paper, has_accessible, opening_hours, floor, description,
        avg_rating, comment_count, verified_at, rejected_reason, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'AMAP', 'PUBLIC', ?, 1, NULL, NULL, '全天开放', NULL, NULL, 0, 0, ?, NULL, ?, ?, ?)
    `);

    for (const poi of pois) {
      const externalId = String(poi?.externalId || '').trim();
      const name = String(poi?.name || '').trim();
      const lng = Number(poi?.lng);
      const lat = Number(poi?.lat);
      const address = String(poi?.address || '').trim() || null;

      if (!externalId || !name || !Number.isFinite(lng) || !Number.isFinite(lat)) {
        continue;
      }

      if (findByAmapId.get(externalId)) {
        continue;
      }

      // 40米内去重，防止与已有本地点位重叠
      const bbox = getBoundingBox(lng, lat, 50);
      const nearRows = db
        .prepare(
          `SELECT id, lng, lat FROM toilets
           WHERE status = 'PUBLIC'
             AND lat BETWEEN ? AND ?
             AND lng BETWEEN ? AND ?`
        )
        .all(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng) as {
        id: string;
        lng: number;
        lat: number;
      }[];

      const tooClose = nearRows.some(
        (r) => haversineDistance(lng, lat, Number(r.lng), Number(r.lat)) < 40
      );
      if (tooClose) continue;

      insertStmt.run(
        generateId('tp'),
        name.slice(0, 60),
        lng,
        lat,
        address,
        externalId,
        now,
        systemOwnerId,
        now,
        now
      );
      synced++;
    }

    return NextResponse.json({
      code: 200,
      data: { synced },
    });
  } catch (error) {
    console.error('[POST /api/v1/toilets/sync error]', error);
    return NextResponse.json(
      { code: 500, message: '同步POI失败' },
      { status: 500 }
    );
  }
}
