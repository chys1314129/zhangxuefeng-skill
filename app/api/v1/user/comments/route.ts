import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { formatTimeAgo } from '@/lib/dateUtils';
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

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT 
         c.id, c.toilet_id, c.content, c.rating, c.created_at,
         t.name as toilet_name, t.address as toilet_address
       FROM comments c
       JOIN toilets t ON t.id = c.toilet_id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(user.id) as Record<string, any>[];

  const comments = rows.map((r) => {
    const createdAt = String(r.created_at);
    return {
      id: String(r.id),
      toiletId: String(r.toilet_id),
      toiletName: String(r.toilet_name),
      toiletAddress: r.toilet_address ? String(r.toilet_address) : null,
      content: String(r.content),
      rating: r.rating !== null && r.rating !== undefined ? Number(r.rating) : null,
      createdAt,
      timeAgo: formatTimeAgo(new Date(createdAt)),
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
      },
    };
  });

  return NextResponse.json({
    code: 200,
    data: { comments },
  });
}
