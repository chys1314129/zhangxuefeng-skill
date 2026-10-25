import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb, getToiletById } from '@/lib/db';
import { generateId } from '@/lib/utils';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return NextResponse.json(
      { code: 403, message: '无管理员权限' },
      { status: 403 }
    );
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT id, status, source FROM toilets WHERE id = ?')
    .get(params.id) as
    | { id: string; status: string; source: string }
    | undefined;

  if (!existing) {
    return NextResponse.json(
      { code: 404, message: '厕所点位不存在' },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();
  const wasInferred = existing.source === 'INFERRED';
  const nextSource = wasInferred ? 'USER' : existing.source;

  db.prepare(
    `UPDATE toilets
     SET source = ?,
         status = 'PUBLIC',
         admin_verified = 1,
         inferred_hidden = 0,
         verified_at = ?,
         rejected_reason = NULL,
         updated_at = ?
     WHERE id = ?`
  ).run(nextSource, now, now, params.id);

  // 自动记录管理员一票「亲测可用」
  db.prepare(
    `INSERT INTO toilet_verifications (id, toilet_id, user_id, vote, created_at, updated_at)
     VALUES (?, ?, ?, 'AVAILABLE', ?, ?)
     ON CONFLICT(toilet_id, user_id) DO UPDATE SET vote = 'AVAILABLE', updated_at = excluded.updated_at`
  ).run(generateId('tv'), params.id, user.id, now, now);

  const toilet = getToiletById(params.id, user.id, user.role);
  return NextResponse.json({
    code: 200,
    message: wasInferred
      ? '🛡️ 管理员实地认证成功！该推测点位已直接转正为正式公开公厕'
      : '🛡️ 管理员实地验证通过！该厕所位置已直接向所有用户公开显示',
    data: { toilet },
  });
}
