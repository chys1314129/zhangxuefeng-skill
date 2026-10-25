import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb, getToiletById } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  const toilet = getToiletById(params.id, user?.id, user?.role);

  if (!toilet) {
    return NextResponse.json(
      { code: 404, message: '未找到该厕所或您无权查看该私有标记' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    code: 200,
    data: { toilet },
  });
}

export async function PUT(
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
  const existing = db
    .prepare('SELECT * FROM toilets WHERE id = ?')
    .get(params.id) as Record<string, any> | undefined;

  if (!existing) {
    return NextResponse.json(
      { code: 404, message: '厕所不存在' },
      { status: 404 }
    );
  }

  const isOwner = existing.created_by === user.id;
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { code: 403, message: '只能修改自己添加的厕所' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const name = String(body.name ?? existing.name).trim().slice(0, 50);
  if (!name) {
    return NextResponse.json(
      { code: 400, message: '名称不能为空' },
      { status: 400 }
    );
  }

  const isFree =
    body.isFree === undefined ? existing.is_free : body.isFree ? 1 : 0;
  const hasPaper =
    body.hasPaper === undefined
      ? existing.has_paper
      : body.hasPaper === null
        ? null
        : body.hasPaper
          ? 1
          : 0;
  const hasAccessible =
    body.hasAccessible === undefined
      ? existing.has_accessible
      : body.hasAccessible === null
        ? null
        : body.hasAccessible
          ? 1
          : 0;
  const floor =
    body.floor === undefined
      ? existing.floor
      : String(body.floor || '').trim().slice(0, 30) || null;
  const openingHours =
    body.openingHours === undefined
      ? existing.opening_hours
      : String(body.openingHours || '').trim().slice(0, 50) || null;
  const description =
    body.description === undefined
      ? existing.description
      : String(body.description || '').trim().slice(0, 200) || null;

  // 若原先被拒绝且已有照片，修改后自动重新进入待审核
  const photoCntRow = db
    .prepare('SELECT COUNT(*) as cnt FROM toilet_photos WHERE toilet_id = ?')
    .get(params.id) as { cnt: number };
  let nextStatus = String(existing.status);
  let nextRejectedReason = existing.rejected_reason;
  if (existing.status === 'REJECTED' && Number(photoCntRow?.cnt || 0) > 0) {
    nextStatus = 'PENDING';
    nextRejectedReason = null;
  }

  db.prepare(
    `UPDATE toilets
     SET name = ?, is_free = ?, has_paper = ?, has_accessible = ?,
         floor = ?, opening_hours = ?, description = ?,
         status = ?, rejected_reason = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    name,
    isFree,
    hasPaper,
    hasAccessible,
    floor,
    openingHours,
    description,
    nextStatus,
    nextRejectedReason,
    new Date().toISOString(),
    params.id
  );

  const updated = getToiletById(params.id, user.id, user.role);
  return NextResponse.json({
    code: 200,
    message:
      existing.status === 'REJECTED' && nextStatus === 'PENDING'
        ? '已更新并重新提交审核'
        : '修改已保存',
    data: { toilet: updated },
  });
}

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
  const existing = db
    .prepare('SELECT id, created_by FROM toilets WHERE id = ?')
    .get(params.id) as { id: string; created_by: string } | undefined;

  if (!existing) {
    return NextResponse.json(
      { code: 404, message: '厕所不存在' },
      { status: 404 }
    );
  }

  const isOwner = existing.created_by === user.id;
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { code: 403, message: '无权删除他人添加的厕所' },
      { status: 403 }
    );
  }

  db.prepare('DELETE FROM toilets WHERE id = ?').run(params.id);

  return NextResponse.json({
    code: 200,
    message: '已删除该厕所标记',
  });
}
