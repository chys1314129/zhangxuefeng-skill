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

  const db = getDb();
  const toiletRow = db
    .prepare(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 'PUBLIC' THEN 1 ELSE 0 END) as public_cnt,
         SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_cnt,
         SUM(CASE WHEN status = 'PRIVATE' THEN 1 ELSE 0 END) as private_cnt,
         SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_cnt
       FROM toilets`
    )
    .get() as Record<string, any>;

  const userRow = db
    .prepare('SELECT COUNT(*) as cnt FROM users')
    .get() as { cnt: number };
  const commentRow = db
    .prepare('SELECT COUNT(*) as cnt FROM comments')
    .get() as { cnt: number };

  return NextResponse.json({
    code: 200,
    data: {
      totalToilets: Number(toiletRow?.total || 0),
      publicCount: Number(toiletRow?.public_cnt || 0),
      pendingCount: Number(toiletRow?.pending_cnt || 0),
      privateCount: Number(toiletRow?.private_cnt || 0),
      rejectedCount: Number(toiletRow?.rejected_cnt || 0),
      totalUsers: Number(userRow?.cnt || 0),
      totalComments: Number(commentRow?.cnt || 0),
    },
  });
}
