import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDb, getToiletById } from '@/lib/db';
import { saveUploadedPhoto } from '@/lib/storage';
import { generateId } from '@/lib/utils';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { code: 401, message: '请先登录再上传照片' },
        { status: 401 }
      );
    }

    const db = getDb();
    const toilet = db
      .prepare('SELECT * FROM toilets WHERE id = ?')
      .get(params.id) as Record<string, any> | undefined;

    if (!toilet) {
      return NextResponse.json(
        { code: 404, message: '厕所不存在' },
        { status: 404 }
      );
    }

    const isOwner = toilet.created_by === user.id;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    // 私有或待审/被拒点位仅允许创建者或管理员补传；公开点位允许登录用户补充实拍图
    if (toilet.status !== 'PUBLIC' && !isOwner && !isAdmin) {
      return NextResponse.json(
        { code: 403, message: '无权操作该点位' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const rawPhotos = formData.getAll('photos');
    const files = rawPhotos.filter(
      (f): f is File => typeof File !== 'undefined' && f instanceof File && f.size > 0
    );

    if (files.length === 0) {
      return NextResponse.json(
        { code: 400, message: '请选择至少一张照片' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const insertPhoto = db.prepare(
      `INSERT INTO toilet_photos (id, toilet_id, photo_url, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const file of files.slice(0, 3)) {
      const url = await saveUploadedPhoto(params.id, file);
      insertPhoto.run(generateId('ph'), params.id, url, user.id, now);
    }

    // 核心规则：无照片(PRIVATE)或被拒绝(REJECTED)补充照片后 -> 自动转为 PENDING（待审核）
    let transitionedToPending = false;
    if (toilet.status === 'PRIVATE' || toilet.status === 'REJECTED') {
      db.prepare(
        `UPDATE toilets
         SET status = 'PENDING', rejected_reason = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, params.id);
      transitionedToPending = true;
    }

    const updated = getToiletById(params.id, user.id, user.role);

    return NextResponse.json({
      code: 200,
      data: {
        toilet: updated,
        message: transitionedToPending
          ? '照片补充成功！已转为「待审核」，审核通过后将对所有人公开'
          : '照片上传成功！感谢分享实景图',
      },
    });
  } catch (error: any) {
    console.error('[POST /api/v1/toilets/[id]/photos error]', error);
    return NextResponse.json(
      { code: 500, message: error?.message || '上传照片失败' },
      { status: 500 }
    );
  }
}
