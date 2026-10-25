import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { moderateUploadedPhotos } from '@/lib/autoModeration';
import { countRecentUserPhotos, getDb } from '@/lib/db';
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
      .prepare(
        'SELECT id, status, source, created_by FROM toilets WHERE id = ?'
      )
      .get(params.id) as
      | { id: string; status: string; source: string; created_by: string }
      | undefined;

    if (!toilet) {
      return NextResponse.json(
        { code: 404, message: '厕所不存在' },
        { status: 404 }
      );
    }

    const isOwner = toilet.created_by === user.id;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    // 非公开厕所只允许创建者本人或管理员补充照片；公开及推测点位允许任何登录用户上传照片确认
    if (toilet.status !== 'PUBLIC' && !isOwner && !isAdmin) {
      return NextResponse.json(
        { code: 403, message: '无权为该私有点位上传照片' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const rawPhotos = formData.getAll('photos');
    const photoFiles = rawPhotos.filter(
      (f): f is File =>
        typeof File !== 'undefined' && f instanceof File && f.size > 0
    );

    if (photoFiles.length === 0) {
      return NextResponse.json(
        { code: 400, message: '请至少选择一张照片' },
        { status: 400 }
      );
    }

    const recentCount = countRecentUserPhotos(user.id, 10);
    const mod = isAdmin
      ? { valid: true, autoApproved: true, nextStatus: 'PUBLIC' as const }
      : await moderateUploadedPhotos(photoFiles, recentCount);
    if (!mod.valid) {
      return NextResponse.json(
        { code: 400, message: mod.reason || '照片审核未通过，请上传清晰实拍图' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const insertPhoto = db.prepare(
      `INSERT INTO toilet_photos (id, toilet_id, photo_url, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    const savedUrls: string[] = [];
    for (const file of photoFiles.slice(0, 3)) {
      const url = await saveUploadedPhoto(toilet.id, file);
      insertPhoto.run(generateId('ph'), toilet.id, url, user.id, now);
      savedUrls.push(url);
    }

    let nextStatus = toilet.status;
    let nextSource = toilet.source;
    let message = '实景照片上传成功！';

    // 场景 A：原本是「推测可借用场所 (INFERRED)」-> 自动审核通过后立即转正为正式已确认公开厕所！
    if (toilet.source === 'INFERRED') {
      if (mod.autoApproved) {
        nextSource = 'USER';
        nextStatus = 'PUBLIC';
        db.prepare(
          `UPDATE toilets
           SET source = 'USER',
               status = 'PUBLIC',
               verified_at = ?,
               inferred_hidden = 0,
               created_by = ?,
               updated_at = ?
           WHERE id = ?`
        ).run(now, user.id, now, toilet.id);

        // 同时为上传者自动记入一票“亲测可用”
        db.prepare(
          `INSERT INTO toilet_verifications (id, toilet_id, user_id, vote, created_at, updated_at)
           VALUES (?, ?, ?, 'AVAILABLE', ?, ?)
           ON CONFLICT(toilet_id, user_id) DO UPDATE SET vote = 'AVAILABLE', updated_at = excluded.updated_at`
        ).run(generateId('tv'), toilet.id, user.id, now, now);

        message =
          '🎉 实拍照片已通过自动审核！该场所现已正式转正为「已确认公开厕所」';
      } else {
        message = '照片已上传并进入人工复核队列，确认后将转为正式公开厕所';
      }
    }
    // 场景 B：原本是私人标记 (PRIVATE) 或被驳回 (REJECTED) -> 自动审核通过立即公开！
    else if (toilet.status === 'PRIVATE' || toilet.status === 'REJECTED') {
      nextStatus = mod.nextStatus;
      db.prepare(
        `UPDATE toilets
         SET status = ?,
             verified_at = ?,
             rejected_reason = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(
        nextStatus,
        nextStatus === 'PUBLIC' ? now : null,
        now,
        toilet.id
      );

      message = mod.autoApproved
        ? '🎉 实拍照片已通过自动审核！该厕所现已转为全网公开'
        : '照片已上传，已进入人工复核队列';
    }

    return NextResponse.json({
      code: 200,
      data: {
        photos: savedUrls,
        status: nextStatus,
        source: nextSource,
        autoApproved: mod.autoApproved,
        message,
      },
    });
  } catch (error: any) {
    console.error('[POST /api/v1/toilets/:id/photos error]', error);
    return NextResponse.json(
      { code: 500, message: error?.message || '上传照片失败' },
      { status: 500 }
    );
  }
}
