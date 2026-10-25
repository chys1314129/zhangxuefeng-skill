'use client';

import Link from 'next/link';
import { List, MessageSquare, Navigation, Star, X } from 'lucide-react';
import { estimateWalkMinutes, formatDistance } from '@/lib/geo';
import type { ToiletItem } from '@/types';

interface ToiletListDrawerProps {
  open: boolean;
  onClose: () => void;
  toilets: ToiletItem[];
  onSelect: (toilet: ToiletItem) => void;
  onNavigate: (toilet: ToiletItem) => void;
}

export default function ToiletListDrawer({
  open,
  onClose,
  toilets,
  onSelect,
  onNavigate,
}: ToiletListDrawerProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-xl rounded-t-2xl max-h-[75vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部栏 */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <List className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-800 text-base">
              周边厕所列表（共 {toilets.length} 个）
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 列表内容 */}
        <div className="overflow-y-auto divide-y divide-slate-100 pb-6">
          {toilets.length === 0 ? (
            <div className="py-14 text-center text-slate-400 text-sm">
              当前视野暂无符合筛选条件的厕所，试试拖动地图或放宽筛选
            </div>
          ) : (
            toilets.map((t, idx) => (
              <div
                key={t.id}
                className="p-4 hover:bg-slate-50 transition flex items-start justify-between gap-3"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => {
                    onSelect(t);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    {idx === 0 && (
                      <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">
                        最近
                      </span>
                    )}
                    {t.status === 'PRIVATE' && (
                      <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                        🔒 私有
                      </span>
                    )}
                    {t.status === 'PENDING' && (
                      <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        ⏳ 待审核
                      </span>
                    )}
                    <h4 className="font-semibold text-slate-900 text-sm truncate">
                      {t.name}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
                    {t.distance !== undefined && (
                      <span className="text-blue-600 font-medium">
                        {formatDistance(t.distance)} · 约
                        {estimateWalkMinutes(t.distance)}分钟
                      </span>
                    )}
                    {t.floor && <span>· {t.floor}</span>}
                    {t.avgRating > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-amber-500">
                        <Star className="w-3 h-3 fill-amber-400" />
                        {t.avgRating.toFixed(1)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {t.isFree && (
                      <span className="text-[11px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">
                        免费
                      </span>
                    )}
                    {t.hasPaper === true && (
                      <span className="text-[11px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        有纸
                      </span>
                    )}
                    {t.hasAccessible && (
                      <span className="text-[11px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">
                        无障碍
                      </span>
                    )}
                    {t.address && (
                      <span className="text-[11px] text-slate-400 truncate max-w-[200px]">
                        {t.address}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigate(t)}
                    className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    导航
                  </button>
                  <Link
                    href={`/toilet/${t.id}`}
                    className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    留言({t.commentCount})
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
