import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import {
  buildSetAuthCookie,
  isHttpsRequest,
  signAuthToken,
} from '@/lib/auth';
import { generateId } from '@/lib/utils';

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, '账号至少3个字符')
    .max(20, '账号最多20个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '账号只能包含字母、数字和下划线'),
  password: z
    .string()
    .min(6, '密码至少6个字符')
    .max(50, '密码最多50个字符'),
  nickname: z
    .string()
    .trim()
    .max(20, '昵称最多20个字符')
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, nickname } = registerSchema.parse(body);

    const db = getDb();
    const existing = db
      .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
      .get(username) as { id: string } | undefined;

    if (existing) {
      return NextResponse.json(
        { code: 409, message: '该账号已被注册，请换一个' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = generateId('u');
    const finalNickname = nickname && nickname.length > 0 ? nickname : username;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO users (id, username, password_hash, nickname, avatar_url, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'USER', ?, ?)`
    ).run(id, username, passwordHash, finalNickname, null, now, now);

    const token = await signAuthToken({
      id,
      username,
      nickname: finalNickname,
      role: 'USER',
    });

    const res = NextResponse.json({
      code: 200,
      message: '注册成功',
      data: {
        token,
        user: {
          id,
          username,
          nickname: finalNickname,
          avatarUrl: null,
          role: 'USER',
        },
      },
    });

    res.headers.append(
      'Set-Cookie',
      buildSetAuthCookie(token, isHttpsRequest(request))
    );
    return res;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.errors[0].message },
        { status: 400 }
      );
    }
    console.error('[register error]', error);
    return NextResponse.json(
      { code: 500, message: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}
