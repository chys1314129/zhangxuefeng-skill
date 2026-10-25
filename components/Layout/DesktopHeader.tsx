'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LogIn,
  LogOut,
  MapPin,
  PlusCircle,
  ShieldCheck,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export default function DesktopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  if (pathname === '/login') {
    return null;
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const navItems = [
    {
      href: '/',
      label: '地图找厕',
      icon: MapPin,
      active: pathname === '/',
    },
    {
      href: '/add',
      label: '添加厕所',
      icon: PlusCircle,
      active: pathname.startsWith('/add'),
    },
    ...(isAdmin
      ? [
          {
            href: '/admin/review',
            label: '审核后台',
            icon: ShieldCheck,
            active: pathname.startsWith('/admin'),
          },
        ]
      : []),
    {
      href: '/me',
      label: '个人中心',
      icon: User,
      active: pathname.startsWith('/me'),
    },
  ];

  const handleLogout = async () => {
    await logout();
    toast.success('已退出登录');
    router.push('/');
  };

  return (
    <header className="hidden md:block sticky top-0 z-40 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/90">
      <div className="max-w-7xl mx-auto h-full px-4 lg:px-6 flex items-center justify-between gap-4">
        {/* 左侧品牌 Logo + 导航菜单 */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 group focus:outline-none"
          >
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center text-lg shadow-xs group-hover:bg-blue-700 transition">
              🚽
            </div>
            <div className="leading-tight">
              <span className="font-extrabold text-slate-900 text-base tracking-tight">
                只找厕所
              </span>
              <span className="hidden lg:inline-block ml-2 text-xs text-slate-400 font-normal">
                急的时候，打开就能找到
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors',
                    item.active
                      ? 'bg-blue-50 text-blue-600 font-semibold'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 右侧用户状态与快捷操作 */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/add"
            className="hidden lg:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            标记新厕所
          </Link>

          {user ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <Link
                href="/me"
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 transition"
              >
                <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                  {user.nickname.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-semibold text-slate-700 max-w-[110px] truncate">
                  {user.nickname}
                </span>
                {isAdmin && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                    管理员
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                title="退出登录"
                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 text-slate-700 hover:text-blue-600 text-xs font-semibold transition"
            >
              <LogIn className="w-3.5 h-3.5" />
              登录 / 注册
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
