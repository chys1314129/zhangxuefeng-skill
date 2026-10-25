'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  MapPin,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/lib/dateUtils';

const FILTER_TABS = [
  { key: 'PENDING', label: '待审核' },
  { key: 'PUBLIC', label: '已通过' },
  { key: 'REJECTED', label: '已拒绝' },
];

export default function AdminReviewPage() {
  const router = useRouter();
  const { user, loading, authFetch } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const [tab, setTab] = useState('PENDING');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState(
    '照片模糊或无法确认是公共卫生间，请补拍门口清晰标识牌'
  );
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomPhoto(null);
        setRejectModalId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { data, isLoading, mutate } = useSWR(
    isAdmin ? [`/api/v1/admin/toilets/pending?status=${tab}`, user?.id] : null,
    async ([url]) => {
      const res = await authFetch(url);
      return res.json();
    }
  );

  if (!loading && !isAdmin) {
    return (
      <div className="max-w-md mx-auto px-4 pt-20 text-center">
        <div className="bg-white rounded-2xl p-8 border border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">无管理员权限</h2>
          <Link
            href="/login?redirect=/admin/review"
            className="mt-4 inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold"
          >
            登录管理员账号
          </Link>
        </div>
      </div>
    );
  }

  const items: any[] = data?.data?.toilets || [];

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      const res = await authFetch(`/api/v1/admin/toilets/${id}/approve`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.code === 200) {
        toast.success('审核通过！该厕所现已向所有用户公开');
        mutate();
      } else {
        toast.error(json.message || '操作失败');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalId) return;
    setProcessingId(rejectModalId);
    try {
      const res = await authFetch(
        `/api/v1/admin/toilets/${rejectModalId}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: rejectReason }),
        }
      );
      const json = await res.json();
      if (json.code === 200) {
        toast.success('已拒绝并反馈原因给提交者');
        setRejectModalId(null);
        mutate();
      } else {
        toast.error(json.message || '操作失败');
      }
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-6 pt-4 md:pt-6 pb-24 md:pb-12 space-y-4">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.push('/admin')}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              拍照厕所审核队列
            </h1>
            <p className="text-xs text-slate-500">
              核实实景图片真实性，通过后转为 PUBLIC 全网可见
            </p>
          </div>
        </div>
      </div>

      {/* 状态切换 */}
      <div className="flex bg-white rounded-xl p-1 border border-slate-200/80 gap-1">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
              tab === t.key
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 列表 */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">加载中...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-sm font-medium text-slate-600">
            当前「{FILTER_TABS.find((f) => f.key === tab)?.label}」列表为空
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {items.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-xs space-y-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <span className="font-semibold text-slate-600">
                      提交人：@{item.creator?.nickname}
                    </span>
                    <span>·</span>
                    <span>{formatDateTime(new Date(item.createdAt))}</span>
                  </div>
                  <Link
                    href={`/toilet/${item.id}`}
                    className="text-base font-bold text-slate-900 hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    {item.name}
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                  </Link>
                  {item.address && (
                    <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      {item.address}
                    </div>
                  )}
                </div>

                {item.floor && (
                  <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg shrink-0">
                    {item.floor}
                  </span>
                )}
              </div>

              {item.description && (
                <div className="text-xs text-slate-600 bg-slate-50 rounded-xl p-3">
                  指引描述：{item.description}
                </div>
              )}

              {/* 照片核验 */}
              {item.photos?.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {item.photos.map((p: any) => (
                    <img
                      key={p.id}
                      src={p.photoUrl}
                      alt="待审核实拍"
                      onClick={() => setZoomPhoto(p.photoUrl)}
                      className="w-full h-32 object-cover rounded-xl border border-slate-200 cursor-pointer hover:opacity-90"
                    />
                  ))}
                </div>
              ) : (
                <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                  ⚠️ 该条目暂无图片记录
                </div>
              )}

              {item.status === 'REJECTED' && item.rejectedReason && (
                <div className="text-xs bg-red-50 text-red-700 px-3 py-2 rounded-lg">
                  拒绝原因：{item.rejectedReason}
                </div>
              )}

              {/* 审核按钮 */}
              {item.status === 'PENDING' && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={processingId === item.id}
                    onClick={() => setRejectModalId(item.id)}
                    className="py-2.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                  >
                    <X className="w-4 h-4" />
                    审核拒绝
                  </button>

                  <button
                    type="button"
                    disabled={processingId === item.id}
                    onClick={() => handleApprove(item.id)}
                    className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition"
                  >
                    <Check className="w-4 h-4" />
                    {processingId === item.id ? '处理中...' : '审核通过 · 设为公开'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 拒绝原因弹窗 */}
      {rejectModalId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setRejectModalId(null)}
        >
          <form
            onSubmit={handleRejectSubmit}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-3.5 shadow-2xl"
          >
            <h3 className="text-base font-bold text-slate-900">填写审核拒绝原因</h3>
            <textarea
              rows={3}
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setRejectModalId(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
              >
                取消
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-xs font-semibold"
              >
                确认拒绝
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 图片放大 */}
      {zoomPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomPhoto(null)}
        >
          <img
            src={zoomPhoto}
            alt="大图"
            className="max-w-full max-h-[85vh] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
