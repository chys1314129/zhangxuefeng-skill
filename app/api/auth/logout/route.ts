import { NextRequest, NextResponse } from 'next/server';
import { buildClearAuthCookie, isHttpsRequest } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const res = NextResponse.json({
    code: 200,
    message: '已退出登录',
  });
  res.headers.append(
    'Set-Cookie',
    buildClearAuthCookie(isHttpsRequest(request))
  );
  return res;
}
