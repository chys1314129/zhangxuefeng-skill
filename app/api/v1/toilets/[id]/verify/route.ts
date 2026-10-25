import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { generateId } from '@/lib/utils';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { code: 401, message: '请先登录再提交现场核实反馈' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const vote = String(body?.vote || '').toUpperCase();
    if (vote !== 'AVAILABLE' && vote !== 'UNAVAILABLE') {
      return NextResponse.json(
        { code: 400, message: '无效的核实选项' },
        { status: 400 }
      );
    }

    const db = getDb();
    const toilet = db
      .prepare(
        'SELECT id, source, status, COALESCE(admin_verified, 0) as admin_verified FROM toilets WHERE id = ?'
      )
      .get(params.id) as
      | { id: string; source: string; status: string; admin_verified: number }
      | undefined;

    if (!toilet) {
      return NextResponse.json(
        { code: 404, message: '该点位不存在' },
        { status: 404 }
      );
    }

    const existingVoteRow = db
      .prepare(
        `SELECT id, vote FROM toilet_verifications WHERE toilet_id = ? AND user_id = ?`
      )
      .get(toilet.id, user.id) as { id: string; vote: string } | undefined;

    const now = new Date().toISOString();
    let finalMyVote: 'AVAILABLE' | 'UNAVAILABLE' | null = null;

    if (existingVoteRow && existingVoteRow.vote === vote) {
      // 再次点击同一选项则取消投票
      db.prepare(`DELETE FROM toilet_verifications WHERE id = ?`).run(
        existingVoteRow.id
      );
      finalMyVote = null;
    } else if (existingVoteRow) {
      db.prepare(
        `UPDATE toilet_verifications SET vote = ?, updated_at = ? WHERE id = ?`
      ).run(vote, now, existingVoteRow.id);
      finalMyVote = vote as 'AVAILABLE' | 'UNAVAILABLE';
    } else {
      db.prepare(
        `INSERT INTO toilet_verifications (id, toilet_id, user_id, vote, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(generateId('tv'), toilet.id, user.id, vote, now, now);
      finalMyVote = vote as 'AVAILABLE' | 'UNAVAILABLE';
    }

    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN vote = 'AVAILABLE' THEN 1 ELSE 0 END) as avail,
           SUM(CASE WHEN vote = 'UNAVAILABLE' THEN 1 ELSE 0 END) as unavail
         FROM toilet_verifications
         WHERE toilet_id = ?`
      )
      .get(toilet.id) as { avail: number | null; unavail: number | null };

    const availableVotes = Number(counts?.avail || 0);
    const unavailableVotes = Number(counts?.unavail || 0);

    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    // 针对未由管理员锁定认证的推测点位或高德旧点位：累计 >= 2 票“不可用”（或管理员直接标记不可用）时自动隐藏防误导
    let inferredHidden = false;
    if (Number(toilet.admin_verified || 0) === 0) {
      if (isAdmin && finalMyVote === 'UNAVAILABLE') {
        inferredHidden = true;
      } else if (
        (toilet.source === 'INFERRED' || toilet.source === 'AMAP') &&
        unavailableVotes >= 2 &&
        unavailableVotes > availableVotes
      ) {
        inferredHidden = true;
      }
      db.prepare(
        `UPDATE toilets SET inferred_hidden = ?, updated_at = ? WHERE id = ?`
      ).run(inferredHidden ? 1 : 0, now, toilet.id);
    }

    let message = '已记录你的现场核实反馈，感谢互助！';
    if (finalMyVote === null) {
      message = '已取消你的投票反馈';
    } else if (inferredHidden) {
      message =
        '已累计多位用户反馈“无厕所或不对外”，系统已自动从地图隐藏该推测点位';
    } else if (finalMyVote === 'AVAILABLE') {
      message =
        toilet.source === 'INFERRED'
          ? '感谢确认可用！若方便拍一张现场卫生间照片上传，可直接自动审核转正为正式公厕'
          : '已标记为「亲测可用」，感谢帮助后来者！';
    }

    return NextResponse.json({
      code: 200,
      data: {
        availableVotes,
        unavailableVotes,
        myVote: finalMyVote,
        inferredHidden,
        message,
      },
    });
  } catch (error: any) {
    console.error('[POST /api/v1/toilets/:id/verify error]', error);
    return NextResponse.json(
      { code: 500, message: '提交反馈失败' },
      { status: 500 }
    );
  }
}
