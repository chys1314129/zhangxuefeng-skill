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

  const body = await request.json().catch(() => ({}));
  const reason =
    String(body?.reason || '').trim().slice(0, 120) ||
    '照片不清晰或非真实厕所点位，请补充门牌实景图后重试';

  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM toilets WHERE id = ?')
    .get(params.id) as { id: string } | undefined;

  if (!existing) {
    return NextResponse.json(
      { code: 404, message: '厕所点位不存在' },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE toilets
     SET status = 'REJECTED', rejected_reason = ?, updated_at = ?
     WHERE id = ?`
  ).run(reason, now, params.id);

  const toilet = getToiletById(params.id, user.id, user.role);
  return NextResponse.json({
    code: 200,
    message: '已拒绝该申请并通知创建者',
    data: { toilet },
  });
}
