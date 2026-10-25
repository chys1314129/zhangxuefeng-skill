'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/lib/dateUtils';

export default function MyCommentsPage() {
  const router = useRouter();
  const { user, authFetch } = useAuth();

  const { data, isLoading, mutate } = useSWR(
    user ? [`/api/v1/user/comments`, user.id] : null,
    async ([url]) => {
      const res = await authFetch(url);
      return res.json();
    }
  );

  const comments: any[] = data?.data?.comments || [];

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除这条留言吗？')) return;
    const res = await authFetch(`/api/v1/comments/${id}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (json.code === 200) {
      toast.success('已删除');
      mutate();
    } else {
      toast.error(json.message || '删除失败');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 pt-4 md:pt-6 pb-24 md:pb-12 space-y-4">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => router.push('/me')}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-extrabold text-slate-900">我的留言记录</h1>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">加载中...</div>
      ) : comments.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-slate-200/80">
          <div className="text-3xl mb-2">💬</div>
          <p className="text-sm text-slate-500">你还没有发表过留言</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {comments.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/toilet/${c.toiletId}`}
                  className="text-sm font-bold text-blue-600 hover:underline inline-flex items-center gap-1 truncate"
                >
                  🚽 {c.toiletName}
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </Link>
                {c.rating && (
                  <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded shrink-0">
                    {'⭐'.repeat(c.rating)}
                  </span>
                )}
              </div>

              <p className="text-sm text-slate-700 leading-relaxed">
                {c.content}
              </p>

              <div className="flex items-center justify-between text-xs text-slate-400 pt-1.5 border-t border-slate-50">
                <span>
                  {c.timeAgo} · {formatDateTime(new Date(c.createdAt))}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
