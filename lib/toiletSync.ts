// lib/toiletSync.ts
// 服务端统一的高德 POI / 推测场所增量入库、坐标名称变更同步与下线点位巡检引擎

import { getDb, getSystemAdminId } from '@/lib/db';
import { getBoundingBox, haversineDistance } from '@/lib/geo';
import { generateId } from '@/lib/utils';

export interface SyncPoiInput {
  externalId: string;
  name: string;
  lng: number;
  lat: number;
  address?: string | null;
  floor?: string | null;
  hasAccessible?: boolean | null;
}

export interface SyncInferredInput {
  externalId: string;
  name: string;
  lng: number;
  lat: number;
  address?: string | null;
  inferredCategory?: string | null;
  openingHours?: string | null;
  description?: string | null;
}

export interface SyncBatchOptions {
  pois?: SyncPoiInput[];
  inferredVenues?: SyncInferredInput[];
  fullScan?: boolean;
  scanCenter?: {
    lng: number;
    lat: number;
    force?: boolean;
  } | null;
}

export interface SyncBatchResult {
  synced: number;
  updated: number;
  retired: number;
  syncedInferred: number;
}

export function syncDiscoveredPoisToDb(opts: SyncBatchOptions): SyncBatchResult {
  const pois = Array.isArray(opts.pois) ? opts.pois.slice(0, 250) : [];
  const inferredVenues = Array.isArray(opts.inferredVenues)
    ? opts.inferredVenues.slice(0, 120)
    : [];
  const fullScan = Boolean(opts.fullScan);
  const scanCenter = opts.scanCenter || null;

  if (pois.length === 0 && inferredVenues.length === 0) {
    return { synced: 0, updated: 0, retired: 0, syncedInferred: 0 };
  }

  const db = getDb();
  const systemOwnerId = getSystemAdminId();
  const now = new Date().toISOString();
  let synced = 0;
  let updated = 0;
  let retired = 0;
  let syncedInferred = 0;

  const findByAmapId = db.prepare(`
    SELECT id, name, lng, lat, address, floor, has_accessible,
           source, status, COALESCE(admin_verified, 0) as admin_verified,
           COALESCE(inferred_hidden, 0) as inferred_hidden
    FROM toilets
    WHERE amap_id = ?
  `);

  const insertConfirmedStmt = db.prepare(`
    INSERT OR IGNORE INTO toilets (
      id, name, lng, lat, address, source, status, amap_id,
      is_free, has_paper, has_accessible, opening_hours, floor, description,
      avg_rating, comment_count, admin_verified, verified_at, last_synced_at,
      rejected_reason, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'AMAP', 'PUBLIC', ?, 1, NULL, ?, '全天开放', ?, NULL, 0, 0, 0, ?, ?, NULL, ?, ?, ?)
  `);

  const updateConfirmedFromAmapStmt = db.prepare(`
    UPDATE toilets
    SET name = ?,
        lng = ?,
        lat = ?,
        address = COALESCE(?, address),
        floor = COALESCE(?, floor),
        has_accessible = COALESCE(?, has_accessible),
        last_synced_at = ?,
        updated_at = ?
    WHERE id = ?
  `);

  const touchSyncedAtStmt = db.prepare(`
    UPDATE toilets SET last_synced_at = ? WHERE id = ?
  `);

  const insertInferredStmt = db.prepare(`
    INSERT OR IGNORE INTO toilets (
      id, name, lng, lat, address, source, status, amap_id,
      inferred_category, inferred_hidden, is_free, opening_hours, description,
      avg_rating, comment_count, admin_verified, verified_at, last_synced_at,
      rejected_reason, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'INFERRED', 'PUBLIC', ?, ?, 0, 1, ?, ?, 0, 0, 0, NULL, ?, NULL, ?, ?, ?)
  `);

  const updateInferredFromAmapStmt = db.prepare(`
    UPDATE toilets
    SET name = ?,
        lng = ?,
        lat = ?,
        address = COALESCE(?, address),
        last_synced_at = ?,
        updated_at = ?
    WHERE id = ?
  `);

  const seenConfirmedIds = new Set<string>();

  for (const poi of pois) {
    const externalId = String(poi?.externalId || '').trim();
    const name = String(poi?.name || '').trim().slice(0, 60);
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

    seenConfirmedIds.add(externalId);

    const existing = findByAmapId.get(externalId) as
      | {
          id: string;
          name: string;
          lng: number;
          lat: number;
          address: string | null;
          floor: string | null;
          has_accessible: number | null;
          source: string;
          status: string;
          admin_verified: number;
          inferred_hidden: number;
        }
      | undefined;

    if (existing) {
      if (
        existing.source === 'AMAP' &&
        existing.status === 'PUBLIC' &&
        Number(existing.admin_verified) === 0
      ) {
        const coordMoved =
          haversineDistance(
            Number(existing.lng),
            Number(existing.lat),
            lng,
            lat
          ) > 1.5;
        const nameChanged = existing.name !== name;
        const addrChanged = Boolean(address && address !== existing.address);
        const floorChanged = Boolean(floor && floor !== existing.floor);
        const accChanged =
          hasAccessible !== null && hasAccessible !== existing.has_accessible;

        if (
          coordMoved ||
          nameChanged ||
          addrChanged ||
          floorChanged ||
          accChanged
        ) {
          updateConfirmedFromAmapStmt.run(
            name,
            lng,
            lat,
            address,
            floor,
            hasAccessible,
            now,
            now,
            existing.id
          );
          updated++;
        } else {
          touchSyncedAtStmt.run(now, existing.id);
        }
      } else {
        touchSyncedAtStmt.run(now, existing.id);
      }
      continue;
    }

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
      name,
      lng,
      lat,
      address,
      externalId,
      hasAccessible,
      floor,
      now,
      now,
      systemOwnerId,
      now,
      now
    );
    synced++;
  }

  // 当完成一次完整的高德周边检索后，自动巡检中心圈内已被高德下线/拆除的陈旧纯 AMAP 点位
  if (fullScan && scanCenter && pois.length >= 3) {
    let maxReturnedDist = 0;
    for (const poi of pois) {
      const d = haversineDistance(
        scanCenter.lng,
        scanCenter.lat,
        Number(poi.lng),
        Number(poi.lat)
      );
      if (d > maxReturnedDist) maxReturnedDist = d;
    }

    const safeCleanRadius = Math.min(maxReturnedDist * 0.7, 800);
    if (safeCleanRadius >= 150) {
      const cleanBox = getBoundingBox(
        scanCenter.lng,
        scanCenter.lat,
        safeCleanRadius
      );
      const staleCandidates = db
        .prepare(
          `SELECT t.id, t.amap_id, t.lng, t.lat, t.last_synced_at
           FROM toilets t
           WHERE t.source = 'AMAP'
             AND t.amap_id LIKE 'amap_%'
             AND COALESCE(t.admin_verified, 0) = 0
             AND COALESCE(t.inferred_hidden, 0) = 0
             AND t.comment_count = 0
             AND t.lat BETWEEN ? AND ?
             AND t.lng BETWEEN ? AND ?
             AND NOT EXISTS(SELECT 1 FROM toilet_photos tp WHERE tp.toilet_id = t.id)
             AND NOT EXISTS(SELECT 1 FROM toilet_verifications tv WHERE tv.toilet_id = t.id AND tv.vote = 'AVAILABLE')`
        )
        .all(
          cleanBox.minLat,
          cleanBox.maxLat,
          cleanBox.minLng,
          cleanBox.maxLng
        ) as {
        id: string;
        amap_id: string;
        lng: number;
        lat: number;
        last_synced_at: string | null;
      }[];

      const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
      const retireStmt = db.prepare(
        `UPDATE toilets SET inferred_hidden = 1, updated_at = ? WHERE id = ?`
      );

      for (const cand of staleCandidates) {
        if (seenConfirmedIds.has(cand.amap_id)) continue;
        const dist = haversineDistance(
          scanCenter.lng,
          scanCenter.lat,
          Number(cand.lng),
          Number(cand.lat)
        );
        if (dist > safeCleanRadius) continue;

        const lastTs = cand.last_synced_at
          ? new Date(cand.last_synced_at).getTime()
          : 0;
        if (scanCenter.force || !lastTs || lastTs < sevenDaysAgo) {
          retireStmt.run(now, cand.id);
          retired++;
        }
      }
    }
  }

  for (const v of inferredVenues) {
    const externalId = String(v?.externalId || '').trim();
    const name = String(v?.name || '').trim().slice(0, 60);
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

    const existingInf = findByAmapId.get(externalId) as
      | {
          id: string;
          name: string;
          lng: number;
          lat: number;
          address: string | null;
          source: string;
          admin_verified: number;
          inferred_hidden: number;
        }
      | undefined;

    if (existingInf) {
      if (
        existingInf.source === 'INFERRED' &&
        Number(existingInf.admin_verified) === 0 &&
        Number(existingInf.inferred_hidden) === 0
      ) {
        const moved =
          haversineDistance(
            Number(existingInf.lng),
            Number(existingInf.lat),
            lng,
            lat
          ) > 2;
        if (moved || existingInf.name !== name) {
          updateInferredFromAmapStmt.run(
            name,
            lng,
            lat,
            address,
            now,
            now,
            existingInf.id
          );
          updated++;
        } else {
          touchSyncedAtStmt.run(now, existingInf.id);
        }
      }
      continue;
    }

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
      name,
      lng,
      lat,
      address,
      externalId,
      inferredCategory,
      openingHours,
      description,
      now,
      systemOwnerId,
      now,
      now
    );
    syncedInferred++;
  }

  return { synced, updated, retired, syncedInferred };
}
