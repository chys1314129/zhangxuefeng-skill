import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth';
import { formatTimeAgo } from '@/lib/dateUtils';
import { getDb, recalculateToiletStats } from '@/lib/db';
import { generateId } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || '20', 10), 1),
    50
  );
  const offset = (page - 1) * limit;
  const toiletId = params.id;

  const db = getDb();
  const toilet = db
    .prepare('SELECT id, status, created_by FROM toilets WHERE id = ?')
    .get(toiletId) as { id: string; status: string; created_by: string } | undefined;

  if (!toilet) {
    return NextResponse.json(
      { code: 404, message: '厕所不存在' },
      { status: 404 }
    );
  }

  if (toilet.status !== 'PUBLIC') {
    const user = await getAuthUser(request);
    const canView =
      user &&
      (user.id === toilet.created_by ||
        user.role === 'ADMIN' ||
        user.role === 'SUPER_ADMIN');
    if (!canView) {
      return NextResponse.json(
        { code: 403, message: '无权查看私有标记留言' },
        { status: 403 }
      );
    }
  }

  const totalRow = db
    .prepare('SELECT COUNT(*) as cnt FROM comments WHERE toilet_id = ?')
    .get(toiletId) as { cnt: number };
  const total = Number(totalRow?.cnt || 0);

  const rows = db
    .prepare(
      `SELECT 
         c.id, c.content, c.rating, c.created_at,
         u.id as user_id, u.username, u.nickname, u.avatar_url
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.toilet_id = ?
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(toiletId, limit, offset) as Record<string, any>[];

  const comments = rows.map((r) => {
    const createdAt = String(r.created_at);
    return {
      id: String(r.id),
      content: String(r.content),
      rating: r.rating !== null && r.rating !== undefined ? Number(r.rating) : null,
      createdAt,
      timeAgo: formatTimeAgo(new Date(createdAt)),
      user: {
        id: String(r.user_id),
        nickname: String(r.nickname || r.username),
        avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
      },
    };
  });

  return NextResponse.json({
    code: 200,
    data: {
      comments,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore: offset + limit < total,
    },
  });
}

const commentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, '留言不能为空')
    .max(500, '留言最多500字'),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { code: 401, message: '请先登录再留言' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { content, rating } = commentSchema.parse(body);
    const toiletId = params.id;

    const db = getDb();
    const toilet = db
      .prepare('SELECT id FROM toilets WHERE id = ?')
      .get(toiletId) as { id: string } | undefined;

    if (!toilet) {
      return NextResponse.json(
        { code: 404, message: '厕所不存在' },
        { status: 404 }
      );
    }

    // 限流：同一用户对同一厕所每分钟最多1条
    const oneMinuteAgoIso = new Date(Date.now() - 60 * 1000).toISOString();
    const recent = db
      .prepare(
        `SELECT id FROM comments
         WHERE toilet_id = ? AND user_id = ? AND created_at >= ?
         LIMIT 1`
      )
      .get(toiletId, user.id, oneMinuteAgoIso) as { id: string } | undefined;

    if (recent) {
      return NextResponse.json(
        { code: 429, message: '发言太频繁，同一厕所每分钟最多留言1条，请稍后再试' },
        { status: 429 }
      );
    }

    const commentId = generateId('cm');
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO comments (id, toilet_id, user_id, content, rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(commentId, toiletId, user.id, content, rating ?? null, now, now);

    recalculateToiletStats(db, toiletId);

    return NextResponse.json({
      code: 200,
      data: {
        comment: {
          id: commentId,
          content,
          rating: rating ?? null,
          createdAt: now,
          timeAgo: '刚刚',
          user: {
            id: user.id,
            nickname: user.nickname || user.username,
            avatarUrl: user.avatarUrl,
          },
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.errors[0].message },
        { status: 400 }
      );
    }
    console.error('[POST comment error]', error);
    return NextResponse.json(
      { code: 500, message: '发表留言失败' },
      { status: 500 }
    );
  }
}
