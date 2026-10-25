'use client';

import Link from 'next/link';
import { MessageSquare, Navigation, Star } from 'lucide-react';
import { estimateWalkMinutes, formatDistance } from '@/lib/geo';
import type { ToiletItem } from '@/types';

interface NearestToiletCardProps {
  toilet: ToiletItem;
  isNearest: boolean;
  onNavigate: (toilet: ToiletItem) => void;
}

export default function NearestToiletCard({
  toilet,
  isNearest,
  onNavigate,
}: NearestToiletCardProps) {
  return (
    <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200/80 p-3.5 sm:p-4 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {isNearest && (
              <span className="inline-flex items-center gap-1 bg-red-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                ⚡ 离你最近
              </span>
            )}
            {toilet.status === 'PRIVATE' && (
              <span className="inline-flex items-center bg-purple-100 text-purple-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                🔒 私人标记
              </span>
            )}
            {toilet.status === 'PENDING' && (
              <span className="inline-flex items-center bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                ⏳ 审核中
              </span>
            )}
            {toilet.floor && (
              <span className="inline-flex items-center bg-slate-100 text-slate-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                {toilet.floor}
              </span>
            )}
          </div>

          <Link
            href={`/toilet/${toilet.id}`}
            className="block text-base font-bold text-slate-900 hover:text-blue-600 truncate"
          >
            {toilet.name}
          </Link>

          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1 flex-wrap">
            {toilet.distance !== undefined && (
              <span className="font-semibold text-blue-600">
                距离 {formatDistance(toilet.distance)} · 步行约{' '}
                {estimateWalkMinutes(toilet.distance)} 分钟
              </span>
            )}
            {toilet.avgRating > 0 && (
              <span className="inline-flex items-center gap-0.5 text-amber-500 font-medium">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {toilet.avgRating.toFixed(1)}
              </span>
            )}
            {toilet.openingHours && (
              <span className="text-slate-400">🕒 {toilet.openingHours}</span>
            )}
          </div>

          {/* 属性标签 */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {toilet.isFree && (
              <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-medium">
                🆓 免费
              </span>
            )}
            {toilet.hasPaper === true && (
              <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-medium">
                🧻 有纸
              </span>
            )}
            {toilet.hasPaper === false && (
              <span className="text-[11px] bg-orange-50 text-orange-700 px-2 py-0.5 rounded-md font-medium">
                ⚠️ 需自备纸
              </span>
            )}
            {toilet.hasAccessible && (
              <span className="text-[11px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-md font-medium">
                ♿ 无障碍
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 底部双按钮：详情留言 + 立即导航 */}
      <div className="grid grid-cols-2 gap-2.5 mt-3 pt-2.5 border-t border-slate-100">
        <Link
          href={`/toilet/${toilet.id}`}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-medium transition"
        >
          <MessageSquare className="w-4 h-4 text-blue-600" />
          详情与留言 ({toilet.commentCount})
        </Link>

        <button
          type="button"
          onClick={() => onNavigate(toilet)}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition"
        >
          <Navigation className="w-4 h-4" />
          一键导航去这
        </button>
      </div>
    </div>
  );
}
