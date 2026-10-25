'use client';

import Link from 'next/link';
import { MessageSquare, Navigation, Star, X } from 'lucide-react';
import { formatDistance } from '@/lib/geo';
import { getInferredCategoryMeta } from '@/lib/inferredVenues';
import { formatWalkMinutes } from '@/lib/routeService';
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
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl rounded-t-3xl max-h-[78vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              附近可用与推测点位 ({toilets.length})
            </h3>
            <p className="text-xs text-slate-500">
              按距你由近到远排序 · 琥珀色标为未核实推测场所
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭列表"
            className="p-2 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-slate-100 px-4 pb-8">
          {toilets.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">
              当前范围内没有找到符合筛选条件的厕所，试试开启「🧭 推测可借用」或添加新点位吧！
            </div>
          ) : (
            toilets.map((t, index) => {
              const isInferred = t.source === 'INFERRED';
              const meta = isInferred
                ? getInferredCategoryMeta(t.inferredCategory)
                : null;

              return (
                <div
                  key={t.id}
                  className="py-3.5 flex items-center justify-between gap-3"
                >
                  <div
                    onClick={() => {
                      onSelect(t);
                      onClose();
                    }}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      {isInferred && meta ? (
                        <>
                          <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded">
                            🧭 推测可能
                          </span>
                          <span className="text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">
                            {meta.emoji} {meta.shortLabel}
                          </span>
                        </>
                      ) : (
                        index === 0 && (
                          <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">
                            最近
                          </span>
                        )
                      )}
                      {t.status === 'PRIVATE' && (
                        <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                          私有
                        </span>
                      )}
                      <h4 className="font-semibold text-slate-900 text-sm truncate">
                        {t.name}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                      {t.distance !== undefined && (
                        <span
                          className={`font-medium ${
                            isInferred ? 'text-amber-700' : 'text-blue-600'
                          }`}
                        >
                          {t.isRouteDistance ? '步行 ' : ''}
                          {formatDistance(t.distance)} (约
                          {formatWalkMinutes(t.walkDuration, t.distance)}分钟)
                        </span>
                      )}
                      {t.floor && <span>· {t.floor}</span>}
                      {(t.availableVotes || 0) > 0 && (
                        <span className="text-emerald-600 font-medium">
                          · ✅ {t.availableVotes}人亲测
                        </span>
                      )}
                      {!isInferred && t.hasPaper === true && <span>· 🧻有纸</span>}
                      {t.avgRating > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-500">
                          <Star className="w-3 h-3 fill-amber-400" />
                          {t.avgRating.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Link
                      href={`/toilet/${t.id}`}
                      onClick={onClose}
                      className="p-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 relative"
                      title="查看留言与详情"
                    >
                      <MessageSquare className="w-4 h-4" />
                      {t.commentCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                          {t.commentCount > 9 ? '9+' : t.commentCount}
                        </span>
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={() => onNavigate(t)}
                      className={`px-3 py-2 rounded-xl text-white text-xs font-semibold inline-flex items-center gap-1 ${
                        isInferred
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      去这里
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
