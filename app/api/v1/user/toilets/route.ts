import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { code: 401, message: '请先登录' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') || 'ALL';

  const db = getDb();
  const whereStatus =
    statusFilter && statusFilter !== 'ALL' ? 'AND t.status = ?' : '';
  const params: string[] = [user.id];
  if (whereStatus) params.push(statusFilter);

  const rows = db
    .prepare(
      `SELECT 
         t.*,
         EXISTS(SELECT 1 FROM toilet_photos tp WHERE tp.toilet_id = t.id) as has_photo
       FROM toilets t
       WHERE t.created_by = ? ${whereStatus}
       ORDER BY t.created_at DESC`
    )
    .all(...params) as Record<string, any>[];

  const photoStmt = db.prepare(
    'SELECT id, toilet_id, photo_url, uploaded_by, created_at FROM toilet_photos WHERE toilet_id = ? ORDER BY created_at DESC'
  );

  const toilets = rows.map((row) => {
    const photos = (photoStmt.all(String(row.id)) as Record<string, any>[]).map(
      (p) => ({
        id: String(p.id),
        toiletId: String(p.toilet_id),
        photoUrl: String(p.photo_url),
        uploadedBy: String(p.uploaded_by),
        createdAt: String(p.created_at),
      })
    );

    return {
      id: String(row.id),
      name: String(row.name),
      lng: Number(row.lng),
      lat: Number(row.lat),
      address: row.address ?? null,
      source: row.source,
      status: row.status,
      isFree: row.is_free === null ? true : Number(row.is_free) === 1,
      hasPaper: row.has_paper === null ? null : Number(row.has_paper) === 1,
      hasAccessible:
        row.has_accessible === null ? null : Number(row.has_accessible) === 1,
      openingHours: row.opening_hours ?? null,
      floor: row.floor ?? null,
      description: row.description ?? null,
      avgRating: Number(row.avg_rating || 0),
      commentCount: Number(row.comment_count || 0),
      verifiedAt: row.verified_at ?? null,
      rejectedReason: row.rejected_reason ?? null,
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      isOwn: true,
      hasPhoto: Boolean(row.has_photo),
      photos,
    };
  });

  return NextResponse.json({
    code: 200,
    data: { toilets },
  });
}
