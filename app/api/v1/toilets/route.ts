import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { moderateUploadedPhotos } from '@/lib/autoModeration';
import {
  countRecentUserPhotos,
  getDb,
  getToiletById,
  queryNearbyToilets,
} from '@/lib/db';
import { getBoundingBox, haversineDistance } from '@/lib/geo';
import { saveUploadedPhoto } from '@/lib/storage';
import { generateId } from '@/lib/utils';
import type { InferredCategory } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lng = parseFloat(searchParams.get('lng') || '116.397428');
    const lat = parseFloat(searchParams.get('lat') || '39.90923');
    const rawUserLng = parseFloat(searchParams.get('userLng') || '');
    const rawUserLat = parseFloat(searchParams.get('userLat') || '');
    const userLng = Number.isFinite(rawUserLng) ? rawUserLng : undefined;
    const userLat = Number.isFinite(rawUserLat) ? rawUserLat : undefined;
    const radius = Math.min(
      Math.max(parseInt(searchParams.get('radius') || '3000', 10), 100),
      20000
    );
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '350', 10), 1),
      500
    );

    const minLng = parseFloat(searchParams.get('minLng') || '');
    const minLat = parseFloat(searchParams.get('minLat') || '');
    const maxLng = parseFloat(searchParams.get('maxLng') || '');
    const maxLat = parseFloat(searchParams.get('maxLat') || '');
    const bounds =
      Number.isFinite(minLng) &&
      Number.isFinite(minLat) &&
      Number.isFinite(maxLng) &&
      Number.isFinite(maxLat)
        ? { minLng, minLat, maxLng, maxLat }
        : null;

    const isFree = searchParams.get('isFree') === 'true';
    const hasPaper = searchParams.get('hasPaper') === 'true';
    const hasAccessible = searchParams.get('hasAccessible') === 'true';
    const onlyMine = searchParams.get('onlyMine') === 'true';
    const keyword = searchParams.get('keyword') || '';
    const includeInferred = searchParams.get('includeInferred') === 'true';
    const rawCat = searchParams.get('inferredCategory') || 'ALL';
    const inferredCategory = rawCat as InferredCategory | 'ALL';

    const user = await getAuthUser(request);

    const result = queryNearbyToilets({
      lng: Number.isFinite(lng) ? lng : 116.397428,
      lat: Number.isFinite(lat) ? lat : 39.90923,
      userLng,
      userLat,
      radius,
      bounds,
      page,
      limit,
      userId: user?.id,
      isFree,
      hasPaper,
      hasAccessible,
      onlyMine,
      keyword,
      includeInferred,
      inferredCategory,
    });

    return NextResponse.json({
      code: 200,
      data: {
        toilets: result.toilets,
        total: result.total,
        page,
        hasMore: result.hasMore,
        confirmedWithin500m: result.confirmedWithin500m,
      },
    });
  } catch (error) {
    console.error('[GET /api/v1/toilets error]', error);
    return NextResponse.json(
      { code: 500, message: '查询附近厕所失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { code: 401, message: '请先登录再添加厕所' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const name = String(formData.get('name') || '').trim();
    const lng = parseFloat(String(formData.get('lng') || ''));
    const lat = parseFloat(String(formData.get('lat') || ''));
    const address = String(formData.get('address') || '').trim() || null;

    if (!name || name.length > 50) {
      return NextResponse.json(
        { code: 400, message: '请输入1-50字的厕所名称' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return NextResponse.json(
        { code: 400, message: '请在地图上选择有效位置' },
        { status: 400 }
      );
    }

    const parseOptionalTriBool = (
      val: FormDataEntryValue | null
    ): number | null => {
      if (val === 'true') return 1;
      if (val === 'false') return 0;
      return null;
    };

    const isFree = formData.get('isFree') === 'false' ? 0 : 1;
    const hasPaper = parseOptionalTriBool(formData.get('hasPaper'));
    const hasAccessible = parseOptionalTriBool(formData.get('hasAccessible'));
    const floor =
      String(formData.get('floor') || '').trim().slice(0, 30) || null;
    const openingHours =
      String(formData.get('openingHours') || '').trim().slice(0, 50) || null;
    const description =
      String(formData.get('description') || '').trim().slice(0, 200) || null;

    const rawPhotos = formData.getAll('photos');
    const photoFiles = rawPhotos.filter(
      (f): f is File =>
        typeof File !== 'undefined' && f instanceof File && f.size > 0
    );

    const db = getDb();

    // 检查 50 米内是否已存在同名确认公开厕所
    const bbox = getBoundingBox(lng, lat, 60);
    const nearbySameName = db
      .prepare(
        `SELECT id, lng, lat FROM toilets
         WHERE status = 'PUBLIC'
           AND source != 'INFERRED'
           AND name = ?
           AND lat BETWEEN ? AND ?
           AND lng BETWEEN ? AND ?`
      )
      .all(name, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng) as {
      id: string;
      lng: number;
      lat: number;
    }[];

    const duplicate = nearbySameName.some(
      (r) => haversineDistance(lng, lat, Number(r.lng), Number(r.lat)) <= 50
    );

    if (duplicate) {
      return NextResponse.json(
        { code: 409, message: '50米内已存在同名公开厕所，无需重复添加' },
        { status: 409 }
      );
    }

    const hasPhotos = photoFiles.length > 0;
    let status: 'PUBLIC' | 'PENDING' | 'PRIVATE' = 'PRIVATE';
    let autoApproved = false;

    if (hasPhotos) {
      const recentCount = countRecentUserPhotos(user.id, 10);
      const mod = await moderateUploadedPhotos(photoFiles, recentCount);
      if (!mod.valid) {
        return NextResponse.json(
          { code: 400, message: mod.reason || '照片审核未通过，请重新选择实拍图' },
          { status: 400 }
        );
      }
      status = mod.nextStatus;
      autoApproved = mod.autoApproved;
    }

    const toiletId = generateId('t');
    const now = new Date().toISOString();
    const verifiedAt = status === 'PUBLIC' ? now : null;

    db.prepare(
      `INSERT INTO toilets (
        id, name, lng, lat, address, source, status, amap_id,
        is_free, has_paper, has_accessible, opening_hours, floor, description,
        avg_rating, comment_count, verified_at, rejected_reason, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'USER', ?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, ?)`
    ).run(
      toiletId,
      name,
      lng,
      lat,
      address,
      status,
      isFree,
      hasPaper,
      hasAccessible,
      openingHours,
      floor,
      description,
      verifiedAt,
      user.id,
      now,
      now
    );

    if (hasPhotos) {
      const insertPhoto = db.prepare(
        `INSERT INTO toilet_photos (id, toilet_id, photo_url, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const file of photoFiles.slice(0, 3)) {
        const photoUrl = await saveUploadedPhoto(toiletId, file);
        insertPhoto.run(generateId('ph'), toiletId, photoUrl, user.id, now);
      }
    }

    const created = getToiletById(toiletId, user.id, user.role);

    return NextResponse.json({
      code: 200,
      data: {
        toilet: created,
        autoApproved,
        message: !hasPhotos
          ? '已添加到你的私人标记（仅自己可见）。补充实拍照片即可自动审核公开'
          : autoApproved
            ? '🎉 添加成功！实景照片已通过自动审核，现已对所有人公开显示'
            : '添加成功！已进入人工复核队列，审核通过后将对所有人公开',
      },
    });
  } catch (error: any) {
    console.error('[POST /api/v1/toilets error]', error);
    return NextResponse.json(
      { code: 500, message: error?.message || '添加厕所失败' },
      { status: 500 }
    );
  }
}
