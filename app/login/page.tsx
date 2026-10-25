'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/';
  const { login, register } = useAuth();

  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    nickname: '',
  });

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await login(form.username.trim(), form.password);
    setLoading(false);

    if (!res.ok) {
      toast.error(res.message);
    } else {
      toast.success('登录成功！');
      router.push(redirectTo);
      router.refresh();
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    const res = await register(
      form.username.trim(),
      form.password,
      form.nickname.trim() || undefined
    );
    setLoading(false);

    if (res.ok) {
      toast.success('注册成功，已自动登录！');
      router.push(redirectTo);
      router.refresh();
    } else {
      toast.error(res.message);
    }
  }

  async function quickDemoLogin(username: string, password: string, label: string) {
    setLoading(true);
    const res = await login(username, password);
    setLoading(false);
    if (res.ok) {
      toast.success(`已使用「${label}」登录`);
      router.push(redirectTo);
      router.refresh();
    } else {
      toast.error(res.message);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white text-3xl shadow-lg shadow-blue-600/25 mb-3">
            🚽
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">只找厕所</h1>
          <p className="text-slate-500 text-sm mt-1">
            急的时候，打开就能找到 · 众包实况避坑
          </p>
        </div>

        {/* 切换登录/注册 */}
        <div className="flex bg-slate-200/70 rounded-xl p-1 mb-5">
          <button
            type="button"
            onClick={() => setIsRegister(false)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
              !isRegister
                ? 'bg-white shadow-xs text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            账号登录
          </button>
          <button
            type="button"
            onClick={() => setIsRegister(true)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
              isRegister
                ? 'bg-white shadow-xs text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            快速注册
          </button>
        </div>

        {/* 表单 */}
        <form
          onSubmit={isRegister ? handleRegister : handleLogin}
          className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              账号
            </label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="字母、数字或下划线，3-20位"
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={3}
              maxLength={20}
              pattern="^[a-zA-Z0-9_]+$"
            />
          </div>

          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                昵称{' '}
                <span className="text-slate-400 font-normal text-xs">
                  （选填，默认使用账号名）
                </span>
              </label>
              <input
                type="text"
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                placeholder="给自己起个名字"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={20}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              密码
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="至少6位字符"
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={6}
            />
          </div>

          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                确认密码
              </label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm({ ...form, confirmPassword: e.target.value })
                }
                placeholder="再输入一次密码"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                minLength={6}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-blue-700 transition shadow-xs"
          >
            {loading ? '请稍候...' : isRegister ? '立即注册并登录' : '登录'}
          </button>
        </form>

        {/* 演示账号一键登录 */}
        <div className="mt-5 bg-white rounded-2xl border border-slate-200/80 p-4">
          <div className="text-xs font-semibold text-slate-500 mb-2.5 text-center">
            ⚡ 预览体验 · 一键免输登录测试账号
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => quickDemoLogin('demo_user', '123456', '找厕达人小王')}
              className="py-2 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition"
            >
              👤 普通用户体验
              <span className="block text-[10px] font-normal text-blue-500 mt-0.5">
                含私人标记 & 待审点位
              </span>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => quickDemoLogin('admin', 'admin123', '系统管理员')}
              className="py-2 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold transition"
            >
              🛡️ 管理员后台
              <span className="block text-[10px] font-normal text-amber-600 mt-0.5">
                可审核通过/拒绝新厕所
              </span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push('/')}
          className="w-full mt-4 text-slate-400 text-sm text-center hover:text-slate-600 py-2"
        >
          先逛逛，不登录 →
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginContent />
    </Suspense>
  );
}
