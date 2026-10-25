import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb, getToiletById } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return NextResponse.json(
      { code: 403, message: '无权限' },
      { status: 403 }
    );
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT id, status FROM toilets WHERE id = ?')
    .get(params.id) as { id: string; status: string } | undefined;

  if (!existing) {
    return NextResponse.json(
      { code: 404, message: '厕所点位不存在' },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE toilets
     SET status = 'PUBLIC', verified_at = ?, rejected_reason = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now, now, params.id);

  const toilet = getToiletById(params.id, user.id, user.role);
  return NextResponse.json({
    code: 200,
    message: '审核通过！该厕所已对所有用户公开显示',
    data: { toilet },
  });
}
