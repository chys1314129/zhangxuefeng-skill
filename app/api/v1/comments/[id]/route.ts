import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb, recalculateToiletStats } from '@/lib/db';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { code: 401, message: '请先登录' },
      { status: 401 }
    );
  }

  const db = getDb();
  const comment = db
    .prepare('SELECT id, toilet_id, user_id FROM comments WHERE id = ?')
    .get(params.id) as
    | { id: string; toilet_id: string; user_id: string }
    | undefined;

  if (!comment) {
    return NextResponse.json(
      { code: 404, message: '留言不存在' },
      { status: 404 }
    );
  }

  const isOwner = comment.user_id === user.id;
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { code: 403, message: '无权删除该留言' },
      { status: 403 }
    );
  }

  db.prepare('DELETE FROM comments WHERE id = ?').run(params.id);
  recalculateToiletStats(db, comment.toilet_id);

  return NextResponse.json({
    code: 200,
    message: '已删除',
  });
}
