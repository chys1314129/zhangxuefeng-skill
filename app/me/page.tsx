'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ChevronRight,
  LogOut,
  MapPin,
  MessageSquare,
  PlusCircle,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

export default function MePage() {
  const router = useRouter();
  const { user, loading, logout, authFetch } = useAuth();

  const { data } = useSWR(
    user ? [`/api/v1/user/profile`, user.id] : null,
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

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 pt-16 pb-24">
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-50 text-3xl flex items-center justify-center mx-auto mb-3">
            👤
          </div>
          <h2 className="text-lg font-extrabold text-slate-900">尚未登录</h2>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            登录后可管理你的私人厕所标记、查看审核进度、发表实时避坑留言。
          </p>
          <Link
            href="/login?redirect=/me"
            className="mt-6 block w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition"
          >
            登录 / 注册账号
          </Link>
        </div>
      </div>
    );
  }

  const stats = data?.data?.stats || {
    toiletCount: 0,
    publicCount: 0,
    pendingCount: 0,
    privateCount: 0,
    rejectedCount: 0,
    commentCount: 0,
  };

  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

  const handleLogout = async () => {
    await logout();
    toast.success('已退出登录');
    router.push('/');
  };

  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-6 pt-5 md:pt-8 pb-24 md:pb-12 space-y-5">
      {/* 用户资料头卡 */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-5 text-white shadow-lg shadow-blue-600/20">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center text-2xl font-extrabold border border-white/30">
            {user.nickname.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-extrabold truncate">{user.nickname}</h1>
              {isAdmin && (
                <span className="text-[11px] bg-amber-400 text-slate-900 font-bold px-2 py-0.5 rounded-full">
                  管理员
                </span>
              )}
            </div>
            <p className="text-xs text-blue-100 mt-0.5">账号：@{user.username}</p>
          </div>
        </div>

        {/* 统计概览 */}
        <div className="grid grid-cols-4 gap-2 mt-5 pt-4 border-t border-white/15 text-center">
          <div>
            <div className="text-lg font-extrabold">{stats.publicCount}</div>
            <div className="text-[11px] text-blue-100">已公开</div>
          </div>
          <div>
            <div className="text-lg font-extrabold">{stats.pendingCount}</div>
            <div className="text-[11px] text-blue-100">待审核</div>
          </div>
          <div>
            <div className="text-lg font-extrabold">{stats.privateCount}</div>
            <div className="text-[11px] text-blue-100">私人标记</div>
          </div>
          <div>
            <div className="text-lg font-extrabold">{stats.commentCount}</div>
            <div className="text-[11px] text-blue-100">我的留言</div>
          </div>
        </div>
      </div>

      {/* 功能菜单：手机单列列表 / 电脑双列卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link
          href="/me/toilets"
          className="flex items-center justify-between px-4 py-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:border-blue-300 hover:bg-blue-50/30 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                我添加的厕所
              </div>
              <div className="text-xs text-slate-400">
                共 {stats.toiletCount} 个点位（私人补图转公开）
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </Link>

        <Link
          href="/me/comments"
          className="flex items-center justify-between px-4 py-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:border-emerald-300 hover:bg-emerald-50/30 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">我的留言</div>
              <div className="text-xs text-slate-400">
                管理发表过的 {stats.commentCount} 条实况反馈
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </Link>

        <Link
          href="/add"
          className="flex items-center justify-between px-4 py-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:border-purple-300 hover:bg-purple-50/30 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                标记一个新厕所
              </div>
              <div className="text-xs text-slate-400">
                有图申请公开 · 无图保存私人备忘
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </Link>

        <Link
          href="/me/settings"
          className="flex items-center justify-between px-4 py-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 hover:bg-slate-50 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                修改昵称与密码
              </div>
              <div className="text-xs text-slate-400">账号安全设置</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </Link>

        {isAdmin && (
          <Link
            href="/admin"
            className="md:col-span-2 flex items-center justify-between px-4 py-4 bg-amber-50/60 rounded-2xl border border-amber-200 shadow-xs hover:bg-amber-50 transition"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-amber-900">
                  管理与照片审核后台
                </div>
                <div className="text-xs text-amber-700">
                  审核用户提交的实景厕所点位，查看全站统计数据
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-600" />
          </Link>
        )}
      </div>

      <button
        type="button"
        onClick={handleLogout}
        className="w-full py-3 rounded-2xl bg-white hover:bg-red-50 text-red-500 border border-slate-200/80 text-sm font-semibold flex items-center justify-center gap-2 transition"
      >
        <LogOut className="w-4 h-4" />
        退出当前账号
      </button>
    </div>
  );
}
