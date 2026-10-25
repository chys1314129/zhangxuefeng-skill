'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  CheckCircle2,
  Clock,
  Lock,
  MessageSquare,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function AdminDashboardPage() {
  const { user, loading, authFetch } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const { data } = useSWR(
    isAdmin ? ['/api/v1/admin/stats', user?.id] : null,
    async ([url]) => {
      const res = await authFetch(url);
      return res.json();
    }
  );

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-slate-400">加载中...</div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto px-4 pt-20 text-center">
        <div className="bg-white rounded-2xl p-8 border border-slate-200">
          <div className="text-4xl mb-2">🛡️</div>
          <h2 className="text-lg font-bold text-slate-900">需要管理员权限</h2>
          <p className="text-xs text-slate-500 mt-1.5">
            请使用管理员账号（演示账号：admin / admin123）登录访问审核后台
          </p>
          <Link
            href="/login?redirect=/admin"
            className="mt-5 inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold"
          >
            切换管理员账号
          </Link>
        </div>
      </div>
    );
  }

  const stats = data?.data || {
    totalToilets: 0,
    publicCount: 0,
    pendingCount: 0,
    privateCount: 0,
    rejectedCount: 0,
    totalUsers: 0,
    totalComments: 0,
  };

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-6 pt-5 md:pt-8 pb-24 md:pb-12 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
            只找厕所 · 运营管理后台
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            管理全站众包厕所点位、实景照片审核与社区留言数据
          </p>
        </div>
        <Link
          href="/admin/review"
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs"
        >
          进入照片审核台 ({stats.pendingCount})
        </Link>
      </div>

      {/* 数据指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <Clock className="w-4 h-4" />
            待审核厕所
          </div>
          <div className="text-2xl font-extrabold text-amber-900 mt-1.5">
            {stats.pendingCount}
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="w-4 h-4" />
            已公开点位
          </div>
          <div className="text-2xl font-extrabold text-emerald-900 mt-1.5">
            {stats.publicCount}
          </div>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-800">
            <Lock className="w-4 h-4" />
            用户私人标记
          </div>
          <div className="text-2xl font-extrabold text-purple-900 mt-1.5">
            {stats.privateCount}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Users className="w-4 h-4 text-blue-600" />
            注册用户总数
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1.5">
            {stats.totalUsers}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <MessageSquare className="w-4 h-4 text-blue-600" />
            实时留言总数
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1.5">
            {stats.totalComments}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-semibold text-slate-600">收录总点位</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1.5">
            {stats.totalToilets}
          </div>
        </div>
      </div>

      {/* 审核入口横幅 */}
      <Link
        href="/admin/review"
        className="block bg-white hover:bg-blue-50/40 rounded-2xl p-5 border border-slate-200/80 shadow-xs transition"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              📸 前往众包厕所审核队列
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              核验用户上传的厕所实景图，通过后立即对全网用户公开展示
            </p>
          </div>
          <span className="px-3.5 py-2 rounded-xl bg-amber-100 text-amber-800 text-xs font-bold">
            {stats.pendingCount} 条待处理 →
          </span>
        </div>
      </Link>
    </div>
  );
}
