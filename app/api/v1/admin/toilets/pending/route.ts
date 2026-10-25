import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return NextResponse.json(
      { code: 403, message: '无管理员权限' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'PENDING';

  const db = getDb();
  const whereClause =
    status === 'ALL' ? `WHERE t.source = 'USER'` : `WHERE t.status = ?`;
  const params = status === 'ALL' ? [] : [status];

  const rows = db
    .prepare(
      `SELECT 
         t.*,
         u.username as creator_username,
         u.nickname as creator_nickname
       FROM toilets t
       LEFT JOIN users u ON u.id = t.created_by
       ${whereClause}
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
      verifiedAt: row.verified_at ?? null,
      rejectedReason: row.rejected_reason ?? null,
      createdAt: String(row.created_at),
      photos,
      creator: {
        id: String(row.created_by),
        username: String(row.creator_username || 'user'),
        nickname: String(row.creator_nickname || row.creator_username || '用户'),
      },
    };
  });

  return NextResponse.json({
    code: 200,
    data: { toilets },
  });
}
