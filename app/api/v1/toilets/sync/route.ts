import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSystemAdminId } from '@/lib/db';
import { getBoundingBox, haversineDistance } from '@/lib/geo';
import { generateId } from '@/lib/utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pois = Array.isArray(body?.pois) ? body.pois.slice(0, 250) : [];
    const inferredVenues = Array.isArray(body?.inferredVenues)
      ? body.inferredVenues.slice(0, 120)
      : [];

    if (pois.length === 0 && inferredVenues.length === 0) {
      return NextResponse.json({ code: 200, data: { synced: 0, syncedInferred: 0 } });
    }

    const db = getDb();
    const systemOwnerId = getSystemAdminId();
    const now = new Date().toISOString();
    let synced = 0;
    let syncedInferred = 0;

    const findByAmapId = db.prepare('SELECT id FROM toilets WHERE amap_id = ?');

    const insertConfirmedStmt = db.prepare(`
      INSERT OR IGNORE INTO toilets (
        id, name, lng, lat, address, source, status, amap_id,
        is_free, has_paper, has_accessible, opening_hours, floor, description,
        avg_rating, comment_count, verified_at, rejected_reason, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'AMAP', 'PUBLIC', ?, 1, NULL, ?, '全天开放', ?, NULL, 0, 0, ?, NULL, ?, ?, ?)
    `);

    const insertInferredStmt = db.prepare(`
      INSERT OR IGNORE INTO toilets (
        id, name, lng, lat, address, source, status, amap_id,
        inferred_category, inferred_hidden, is_free, opening_hours, description,
        avg_rating, comment_count, verified_at, rejected_reason, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'INFERRED', 'PUBLIC', ?, ?, 0, 1, ?, ?, 0, 0, NULL, NULL, ?, ?, ?)
    `);

    for (const poi of pois) {
      const externalId = String(poi?.externalId || '').trim();
      const name = String(poi?.name || '').trim();
      const lng = Number(poi?.lng);
      const lat = Number(poi?.lat);
      const address = String(poi?.address || '').trim() || null;
      const floor =
        typeof poi?.floor === 'string' && poi.floor.trim()
          ? poi.floor.trim().slice(0, 20)
          : null;
      const hasAccessible =
        poi?.hasAccessible === true
          ? 1
          : poi?.hasAccessible === false
            ? 0
            : null;

      if (!externalId || !name || !Number.isFinite(lng) || !Number.isFinite(lat)) {
        continue;
      }

      if (findByAmapId.get(externalId)) {
        continue;
      }

      // 仅与用户自建的 12 米内极近公开点位去重
      const bbox = getBoundingBox(lng, lat, 18);
      const nearUserRows = db
        .prepare(
          `SELECT id, lng, lat FROM toilets
           WHERE status = 'PUBLIC'
             AND source = 'USER'
             AND lat BETWEEN ? AND ?
             AND lng BETWEEN ? AND ?`
        )
        .all(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng) as {
        id: string;
        lng: number;
        lat: number;
      }[];

      const overlapsUserPoint = nearUserRows.some(
        (r) => haversineDistance(lng, lat, Number(r.lng), Number(r.lat)) < 12
      );
      if (overlapsUserPoint) continue;

      insertConfirmedStmt.run(
        generateId('tp'),
        name.slice(0, 60),
        lng,
        lat,
        address,
        externalId,
        hasAccessible,
        floor,
        now,
        systemOwnerId,
        now,
        now
      );
      synced++;
    }

    for (const v of inferredVenues) {
      const externalId = String(v?.externalId || '').trim();
      const name = String(v?.name || '').trim();
      const lng = Number(v?.lng);
      const lat = Number(v?.lat);
      const address = String(v?.address || '').trim() || null;
      const inferredCategory = String(v?.inferredCategory || 'MALL').trim();
      const openingHours =
        String(v?.openingHours || '以场所营业时间为准').trim().slice(0, 40) || null;
      const description =
        String(v?.description || '').trim().slice(0, 220) || null;

      if (!externalId || !name || !Number.isFinite(lng) || !Number.isFinite(lat)) {
        continue;
      }

      // 若该场所已存在（包括已被用户上传照片转正或已被负评自动隐藏），绝不覆盖
      if (findByAmapId.get(externalId)) {
        continue;
      }

      // 若 35 米内已存在明确确认的公厕，跳过插入重复推测点
      const bbox = getBoundingBox(lng, lat, 40);
      const nearConfirmed = db
        .prepare(
          `SELECT id, lng, lat FROM toilets
           WHERE status = 'PUBLIC'
             AND source != 'INFERRED'
             AND lat BETWEEN ? AND ?
             AND lng BETWEEN ? AND ?`
        )
        .all(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng) as {
        id: string;
        lng: number;
        lat: number;
      }[];

      const hasConfirmedNearby = nearConfirmed.some(
        (r) => haversineDistance(lng, lat, Number(r.lng), Number(r.lat)) < 35
      );
      if (hasConfirmedNearby) continue;

      insertInferredStmt.run(
        generateId('ti'),
        name.slice(0, 60),
        lng,
        lat,
        address,
        externalId,
        inferredCategory,
        openingHours,
        description,
        systemOwnerId,
        now,
        now
      );
      syncedInferred++;
    }

    return NextResponse.json({
      code: 200,
      data: { synced, syncedInferred },
    });
  } catch (error) {
    console.error('[POST /api/v1/toilets/sync error]', error);
    return NextResponse.json(
      { code: 500, message: '同步POI失败' },
      { status: 500 }
    );
  }
}
