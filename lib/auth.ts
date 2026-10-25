// lib/auth.ts
// JWT + bcrypt 认证核心模块（同时兼容 Cookie 与 Authorization Header，适配跨站预览 iframe 与生产环境）

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { findUserById } from '@/lib/db';
import type { AuthUser, UserRole } from '@/types';

export const AUTH_COOKIE_NAME = 'zzcs_auth_token';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30天

function getJwtSecret(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'zhizhaocesuo-default-jwt-secret-key-min-32-chars';
  return new TextEncoder().encode(secret);
}

export interface JwtUserPayload {
  id: string;
  username: string;
  nickname: string;
  role: UserRole;
}

export async function signAuthToken(user: JwtUserPayload): Promise<string> {
  return new SignJWT({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifyAuthToken(
  token: string
): Promise<JwtUserPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (!payload.id || !payload.username) return null;
    return {
      id: String(payload.id),
      username: String(payload.username),
      nickname: String(payload.nickname || payload.username),
      role: (payload.role as UserRole) || 'USER',
    };
  } catch {
    return null;
  }
}

export async function getAuthUser(
  request?: NextRequest
): Promise<AuthUser | null> {
  let token: string | undefined;

  if (request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
    if (!token) {
      token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    }
  }

  if (!token) {
    try {
      const cookieStore = cookies();
      token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    } catch {
      // 在非请求上下文中忽略
    }
  }

  if (!token) return null;

  const decoded = await verifyAuthToken(token);
  if (!decoded) return null;

  // 从数据库核实最新用户信息与角色
  const dbUser = findUserById(decoded.id);
  return dbUser;
}

export function isHttpsRequest(request: NextRequest): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) {
    return proto.split(',')[0].trim() === 'https';
  }
  return request.nextUrl.protocol === 'https:';
}

export function buildSetAuthCookie(token: string, isHttps: boolean): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

export function buildClearAuthCookie(isHttps: boolean): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}
