import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
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

  const db = getDb();
  const toiletStats = db
    .prepare(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 'PUBLIC' THEN 1 ELSE 0 END) as public_cnt,
         SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_cnt,
         SUM(CASE WHEN status = 'PRIVATE' THEN 1 ELSE 0 END) as private_cnt,
         SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_cnt
       FROM toilets
       WHERE created_by = ?`
    )
    .get(user.id) as Record<string, any>;

  const commentRow = db
    .prepare('SELECT COUNT(*) as cnt FROM comments WHERE user_id = ?')
    .get(user.id) as { cnt: number };

  return NextResponse.json({
    code: 200,
    data: {
      user,
      stats: {
        toiletCount: Number(toiletStats?.total || 0),
        publicCount: Number(toiletStats?.public_cnt || 0),
        pendingCount: Number(toiletStats?.pending_cnt || 0),
        privateCount: Number(toiletStats?.private_cnt || 0),
        rejectedCount: Number(toiletStats?.rejected_cnt || 0),
        commentCount: Number(commentRow?.cnt || 0),
      },
    },
  });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { code: 401, message: '请先登录' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const db = getDb();
    const now = new Date().toISOString();

    if (body.nickname !== undefined) {
      const nickname = String(body.nickname).trim();
      if (!nickname || nickname.length > 20) {
        return NextResponse.json(
          { code: 400, message: '昵称长度需在 1-20 个字符之间' },
          { status: 400 }
        );
      }
      db.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?').run(
        nickname,
        now,
        user.id
      );
    }

    if (body.newPassword) {
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');

      if (newPassword.length < 6 || newPassword.length > 50) {
        return NextResponse.json(
          { code: 400, message: '新密码长度需在 6-50 位之间' },
          { status: 400 }
        );
      }

      const row = db
        .prepare('SELECT password_hash FROM users WHERE id = ?')
        .get(user.id) as { password_hash: string } | undefined;

      if (!row || !(await bcrypt.compare(currentPassword, row.password_hash))) {
        return NextResponse.json(
          { code: 400, message: '原密码不正确' },
          { status: 400 }
        );
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      db.prepare(
        'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'
      ).run(newHash, now, user.id);
    }

    const updatedUser = db
      .prepare(
        'SELECT id, username, nickname, avatar_url, role FROM users WHERE id = ?'
      )
      .get(user.id) as Record<string, any>;

    return NextResponse.json({
      code: 200,
      message: '保存成功',
      data: {
        user: {
          id: String(updatedUser.id),
          username: String(updatedUser.username),
          nickname: String(updatedUser.nickname || updatedUser.username),
          avatarUrl: updatedUser.avatar_url || null,
          role: updatedUser.role,
        },
      },
    });
  } catch (error) {
    console.error('[PUT /api/v1/user/profile error]', error);
    return NextResponse.json(
      { code: 500, message: '更新失败' },
      { status: 500 }
    );
  }
}
