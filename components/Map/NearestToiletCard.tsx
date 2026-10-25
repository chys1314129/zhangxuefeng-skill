'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Camera,
  ChevronRight,
  MessageSquare,
  Navigation,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { formatDistance } from '@/lib/geo';
import { getInferredCategoryMeta } from '@/lib/inferredVenues';
import { formatWalkMinutes } from '@/lib/routeService';
import type { ToiletItem } from '@/types';

interface NearestToiletCardProps {
  toilet: ToiletItem;
  isNearest?: boolean;
  isAdmin?: boolean;
  onNavigate: (toilet: ToiletItem) => void;
  onAdminDirectVerify?: (toilet: ToiletItem) => void;
  onClose?: () => void;
}

export default function NearestToiletCard({
  toilet,
  isNearest = false,
  isAdmin = false,
  onNavigate,
  onAdminDirectVerify,
  onClose,
}: NearestToiletCardProps) {
  const isInferred = toilet.source === 'INFERRED';
  const inferredMeta = isInferred
    ? getInferredCategoryMeta(toilet.inferredCategory)
    : null;
  const canQuickDirectVerify = Boolean(
    isAdmin &&
      onAdminDirectVerify &&
      (isInferred || toilet.status !== 'PUBLIC')
  );

  return (
    <div
      className={`bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border p-3 sm:p-3.5 transition ${
        isInferred ? 'border-amber-300/90' : 'border-slate-200/80'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            {isInferred && inferredMeta ? (
              <>
                <span className="text-[11px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full">
                  🧭 推测可能·未核实
                </span>
                <span className="text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">
                  {inferredMeta.emoji} {inferredMeta.shortLabel}
                </span>
              </>
            ) : (
              isNearest && (
                <span className="text-[11px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">
                  🔥 距你最近
                </span>
              )
            )}
            {toilet.adminVerified && (
              <span className="text-[11px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full inline-flex items-center gap-0.5">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                管理员核验
              </span>
            )}
            {toilet.status === 'PRIVATE' && (
              <span className="text-[11px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                🔒 私人标记
              </span>
            )}
            {toilet.status === 'PENDING' && (
              <span className="text-[11px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                ⏳ 审核中
              </span>
            )}
            {toilet.floor && (
              <span className="text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                {toilet.floor}
              </span>
            )}
          </div>

          <Link
            href={`/toilet/${toilet.id}`}
            className="group flex items-center gap-1"
          >
            <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate group-hover:text-blue-600 transition">
              {toilet.name}
            </h3>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          </Link>

          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 flex-wrap">
            {toilet.distance !== undefined && (
              <span
                className={`font-semibold ${
                  isInferred ? 'text-amber-700' : 'text-blue-600'
                }`}
              >
                {toilet.isRouteDistance ? '步行路线 ' : '约 '}
                {formatDistance(toilet.distance)} · 约
                {formatWalkMinutes(toilet.walkDuration, toilet.distance)}分钟
              </span>
            )}
            {(toilet.availableVotes || 0) > 0 && (
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                ✅ {toilet.availableVotes}人亲测可用
              </span>
            )}
            {toilet.avgRating > 0 && (
              <span className="inline-flex items-center gap-0.5 text-amber-500 font-medium">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {toilet.avgRating.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="收起卡片"
            title="收起卡片"
            className="p-1.5 -mr-1 -mt-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isInferred ? (
        <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200/80 px-2.5 py-1.5 flex items-start gap-1.5 text-[11px] text-amber-800 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <span>
            仅推测可能提供卫生间（未核实），请看留言或现场传照片自动审核转正
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <span
            className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
              toilet.isFree
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {toilet.isFree ? '🆓 免费' : '💰 收费/消费'}
          </span>

          {toilet.hasPaper === true && (
            <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-blue-50 text-blue-700">
              🧻 有厕纸
            </span>
          )}
          {toilet.hasPaper === false && (
            <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-orange-50 text-orange-700">
              ⚠️ 需自备纸
            </span>
          )}
          {toilet.hasAccessible && (
            <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-sky-50 text-sky-700">
              ♿ 无障碍
            </span>
          )}
          {toilet.openingHours && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
              🕒 {toilet.openingHours}
            </span>
          )}
        </div>
      )}

      {/* 管理员一键免审转正/直接公开快捷栏 */}
      {canQuickDirectVerify && (
        <button
          type="button"
          onClick={() => onAdminDirectVerify?.(toilet)}
          className="mt-2 w-full py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm transition"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          {isInferred
            ? '本人已验证 · 免审直接转正公开'
            : '本人已验证 · 跳过审核直接公开'}
        </button>
      )}

      {/* 操作按钮行 */}
      <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-slate-100">
        <Link
          href={`/toilet/${toilet.id}`}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition ${
            isInferred
              ? 'bg-amber-100/80 hover:bg-amber-200/70 text-amber-900'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
          }`}
        >
          {isInferred ? (
            <>
              <Camera className="w-3.5 h-3.5 text-amber-700" />
              留言/传图确认 ({toilet.commentCount})
            </>
          ) : (
            <>
              <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
              详情与留言 ({toilet.commentCount})
            </>
          )}
        </Link>

        <button
          type="button"
          onClick={() => onNavigate(toilet)}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-white text-xs font-bold shadow-sm transition ${
            isInferred
              ? 'bg-amber-600 hover:bg-amber-700'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          <Navigation className="w-3.5 h-3.5" />
          一键步行导航
        </button>
      </div>
    </div>
  );
}
