'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MapPin, PlusCircle, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export default function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (pathname === '/login') {
    return null;
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const items = [
    {
      href: '/',
      label: '找厕所',
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
      label: user ? '我的' : '未登录',
      icon: User,
      active: pathname.startsWith('/me'),
    },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 safe-area-bottom">
      <div className="flex items-center justify-around h-14 px-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full min-h-[48px] gap-0.5 text-[11px] font-medium transition-colors touch-manipulation active:scale-95',
                item.active
                  ? 'text-blue-600 font-semibold'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              <Icon
                className={cn(
                  'w-5 h-5 transition-transform',
                  item.active && 'scale-110 stroke-[2.4]'
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
