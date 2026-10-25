'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWRInfinite from 'swr/infinite';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import RatingStars from '@/components/Comment/RatingStars';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime, formatTimeAgo } from '@/lib/dateUtils';
import type { CommentItemData } from '@/types';

interface CommentBoardProps {
  toiletId: string;
  onStatsChanged?: () => void;
}

const QUICK_TAGS = [
  '🧻 有纸有洗手液',
  '⚠️ 纸没了请自备',
  '✨ 非常干净无异味',
  '👥 现在要排队',
  '🔓 不用密码直接进',
  '🚪 隔间门锁完好',
];

export default function CommentBoard({
  toiletId,
  onStatsChanged,
}: CommentBoardProps) {
  const { user, authFetch } = useAuth();
  const router = useRouter();

  const [newComment, setNewComment] = useState('');
  const [newRating, setNewRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && !previousPageData?.data?.hasMore) return null;
    return `/api/v1/toilets/${toiletId}/comments?page=${pageIndex + 1}&limit=20`;
  };

  const {
    data: pages,
    size,
    setSize,
    isLoading,
    isValidating,
    mutate,
  } = useSWRInfinite(
    getKey,
    async (url) => {
      const res = await authFetch(url);
      return res.json();
    },
    {
      revalidateFirstPage: true,
      refreshInterval: 25000,
    }
  );

  const comments: CommentItemData[] =
    pages?.flatMap((p) => p?.data?.comments || []) || [];
  const total: number = pages?.[0]?.data?.total || 0;
  const hasMore: boolean = Boolean(
    pages?.[pages.length - 1]?.data?.hasMore
  );

  const appendQuickTag = (tag: string) => {
    if (!user) {
      toast('请先登录再发表留言', {
        action: {
          label: '去登录',
          onClick: () => router.push(`/login?redirect=/toilet/${toiletId}`),
        },
      });
      return;
    }
    setNewComment((prev) => {
      const next = prev ? `${prev} ${tag}` : tag;
      return next.slice(0, 500);
    });
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!user) {
      toast('请先登录再留言', {
        action: {
          label: '去登录',
          onClick: () => router.push(`/login?redirect=/toilet/${toiletId}`),
        },
      });
      return;
    }

    if (!newComment.trim()) {
      toast.error('留言内容不能为空');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch(`/api/v1/toilets/${toiletId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          rating: newRating,
        }),
      });

      const data = await res.json();

      if (data.code === 200) {
        setNewComment('');
        setNewRating(null);
        await mutate();
        onStatsChanged?.();
        toast.success('留言发表成功！感谢为后来人避坑');
      } else {
        toast.error(data.message || '发表失败');
      }
    } catch {
      toast.error('网络异常，发送失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (!window.confirm('确定删除这条留言吗？')) return;

    try {
      const res = await authFetch(`/api/v1/comments/${commentId}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.code === 200) {
        await mutate();
        onStatsChanged?.();
        toast.success('留言已删除');
      } else {
        toast.error(data.message || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-xs border border-slate-200/80 overflow-hidden">
      {/* 头部 */}
      <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2 text-base">
            <span>💬 实时留言板</span>
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              {total} 条留言
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            按最新时间排序 · 告诉大家有没有纸、要不要排队
          </p>
        </div>
        {!user && (
          <button
            type="button"
            onClick={() => router.push(`/login?redirect=/toilet/${toiletId}`)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg"
          >
            登录去留言 →
          </button>
        )}
      </div>

      {/* 输入区 */}
      <form
        onSubmit={handleSubmit}
        className="px-4 py-3.5 border-b border-slate-100 bg-slate-50/50 space-y-2.5"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">可选评分：</span>
            <RatingStars
              value={newRating}
              onChange={(v) => {
                if (!user) {
                  router.push(`/login?redirect=/toilet/${toiletId}`);
                  return;
                }
                setNewRating(v);
              }}
              size="sm"
            />
            {newRating && (
              <button
                type="button"
                onClick={() => setNewRating(null)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                清除
              </button>
            )}
          </div>
          <span className="text-[11px] text-slate-400">
            {newComment.length}/500
          </span>
        </div>

        {/* 快捷标签 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {QUICK_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => appendQuickTag(tag)}
              className="shrink-0 text-[11px] bg-white hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full transition"
            >
              + {tag}
            </button>
          ))}
        </div>

        <div className="flex gap-2 items-end">
          <textarea
            rows={2}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (user && newComment.trim() && !submitting) {
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }
            }}
            placeholder={
              user
                ? '说说这个厕所的最新情况（电脑端支持 Ctrl+Enter 快捷发送）...'
                : '登录后即可发表留言提醒他人'
            }
            disabled={!user}
            maxLength={500}
            className="flex-1 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400 resize-none"
          />
          <button
            type="submit"
            disabled={submitting || !user || !newComment.trim()}
            className="h-[62px] px-5 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition whitespace-nowrap shadow-xs"
          >
            {submitting ? '发送中' : '发送'}
          </button>
        </div>
      </form>

      {/* 留言列表（按 created_at DESC） */}
      <div className="divide-y divide-slate-100">
        {isLoading ? (
          <div className="py-10 text-center text-slate-400 text-sm">
            正在加载最新留言...
          </div>
        ) : comments.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-3xl mb-2">📝</div>
            <p className="text-slate-400 text-sm">
              还没有留言，来写第一条实况反馈吧！
            </p>
          </div>
        ) : (
          comments.map((comment) => {
            const isOwn = user?.id === comment.user.id;
            const isAdmin =
              user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
            const canDelete = isOwn || isAdmin;

            const dateObj = new Date(comment.createdAt);
            const fullDate = formatDateTime(dateObj);
            const timeAgo = formatTimeAgo(dateObj);

            return (
              <div
                key={comment.id}
                className="px-4 py-3.5 hover:bg-slate-50/70 transition group"
              >
                <div className="flex items-start gap-3">
                  {/* 头像 */}
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600 shrink-0">
                    {comment.user.avatarUrl ? (
                      <img
                        src={comment.user.avatarUrl}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      comment.user.nickname.charAt(0).toUpperCase()
                    )}
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-slate-800">
                        {comment.user.nickname}
                      </span>

                      {comment.rating && (
                        <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium">
                          {'⭐'.repeat(comment.rating)}
                        </span>
                      )}

                      {isOwn && (
                        <span className="text-[11px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                          我
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-slate-700 leading-relaxed break-words">
                      {comment.content}
                    </p>

                    {/* 时间（相对时间 · 绝对日期时间） + 删除操作 */}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <time
                          dateTime={comment.createdAt}
                          title={fullDate}
                          className="font-medium text-slate-500"
                        >
                          {timeAgo}
                        </time>
                        <span>·</span>
                        <span>{fullDate}</span>
                      </div>

                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(comment.id)}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 加载更多 */}
      {hasMore && (
        <div className="px-4 py-3 text-center border-t border-slate-100">
          <button
            type="button"
            onClick={() => setSize(size + 1)}
            disabled={isValidating}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400"
          >
            {isValidating ? '加载中...' : '加载更多留言'}
          </button>
        </div>
      )}
    </div>
  );
}
