import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import {
  buildSetAuthCookie,
  isHttpsRequest,
  signAuthToken,
} from '@/lib/auth';
import type { UserRole } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    if (!username || !password) {
      return NextResponse.json(
        { code: 400, message: '请输入账号和密码' },
        { status: 400 }
      );
    }

    const db = getDb();
    const row = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as Record<string, any> | undefined;

    if (!row) {
      return NextResponse.json(
        { code: 401, message: '账号不存在' },
        { status: 401 }
      );
    }

    const isValid = await bcrypt.compare(password, String(row.password_hash));
    if (!isValid) {
      return NextResponse.json(
        { code: 401, message: '密码错误' },
        { status: 401 }
      );
    }

    const user = {
      id: String(row.id),
      username: String(row.username),
      nickname: String(row.nickname || row.username),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      role: (row.role as UserRole) || 'USER',
    };

    const token = await signAuthToken({
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    });

    const res = NextResponse.json({
      code: 200,
      message: '登录成功',
      data: { token, user },
    });

    res.headers.append(
      'Set-Cookie',
      buildSetAuthCookie(token, isHttpsRequest(request))
    );
    return res;
  } catch (error) {
    console.error('[login error]', error);
    return NextResponse.json(
      { code: 500, message: '登录异常，请稍后重试' },
      { status: 500 }
    );
  }
}
