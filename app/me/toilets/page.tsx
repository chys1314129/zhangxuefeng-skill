'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ArrowLeft, Camera, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/lib/dateUtils';
import { compressImage } from '@/lib/imageUtils';
import type { ToiletItem } from '@/types';

const TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'PUBLIC', label: '已公开' },
  { key: 'PENDING', label: '待审核' },
  { key: 'PRIVATE', label: '🔒私人' },
  { key: 'REJECTED', label: '未通过' },
];

export default function MyToiletsPage() {
  const router = useRouter();
  const { user, authFetch } = useAuth();
  const [statusTab, setStatusTab] = useState('ALL');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetToiletIdRef = useRef<string | null>(null);

  const { data, isLoading, mutate } = useSWR(
    user ? [`/api/v1/user/toilets?status=${statusTab}`, user.id] : null,
    async ([url]) => {
      const res = await authFetch(url);
      return res.json();
    }
  );

  const toilets: ToiletItem[] = data?.data?.toilets || [];

  const triggerUploadFor = (toiletId: string) => {
    targetToiletIdRef.current = toiletId;
    fileRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const tid = targetToiletIdRef.current;
    if (!files.length || !tid) return;

    setUploadingId(tid);
    try {
      const formData = new FormData();
      for (const f of files.slice(0, 3)) {
        const compressed = await compressImage(f);
        formData.append('photos', compressed);
      }
      const res = await authFetch(`/api/v1/toilets/${tid}/photos`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.code === 200) {
        toast.success(json.data?.message || '照片上传成功，已转入待审核');
        mutate();
      } else {
        toast.error(json.message || '上传失败');
      }
    } catch {
      toast.error('上传异常');
    } finally {
      setUploadingId(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (t: ToiletItem) => {
    if (!window.confirm(`确认删除「${t.name}」吗？`)) return;
    const res = await authFetch(`/api/v1/toilets/${t.id}`, {
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

  const statusBadge = (status: string) => {
    switch (status) {
      case 'PUBLIC':
        return (
          <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
            ✅ 已公开
          </span>
        );
      case 'PENDING':
        return (
          <span className="text-[11px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
            ⏳ 待审核
          </span>
        );
      case 'REJECTED':
        return (
          <span className="text-[11px] font-semibold bg-red-50 text-red-700 px-2 py-0.5 rounded-full">
            ❌ 审核拒绝
          </span>
        );
      default:
        return (
          <span className="text-[11px] font-semibold bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
            🔒 仅自己可见
          </span>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 pt-4 md:pt-6 pb-24 md:pb-12 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.push('/me')}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-lg font-extrabold text-slate-900">我添加的厕所</h1>
        </div>

        <Link
          href="/add"
          className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold"
        >
          + 新增标记
        </Link>
      </div>

      {/* 状态筛选栏 */}
      <div className="flex bg-white rounded-xl p-1 border border-slate-200/80 gap-1 overflow-x-auto no-scrollbar">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusTab(tab.key)}
            className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
              statusTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 列表 */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">加载中...</div>
      ) : toilets.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-slate-200/80">
          <div className="text-3xl mb-2">🗺️</div>
          <p className="text-sm text-slate-500">该分类下暂无你添加的厕所标记</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {toilets.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {statusBadge(t.status)}
                    <span className="text-[11px] text-slate-400">
                      {formatDateTime(new Date(t.createdAt))}
                    </span>
                  </div>
                  <Link
                    href={`/toilet/${t.id}`}
                    className="font-bold text-slate-900 hover:text-blue-600 text-sm sm:text-base"
                  >
                    {t.name}
                  </Link>
                  {t.address && (
                    <p className="text-xs text-slate-400 mt-0.5">{t.address}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  className="p-1.5 text-slate-400 hover:text-red-500"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {t.status === 'REJECTED' && t.rejectedReason && (
                <div className="text-xs bg-red-50 text-red-700 px-3 py-2 rounded-lg">
                  拒绝原因：{t.rejectedReason}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-2">
                <Link
                  href={`/toilet/${t.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  查看详情与留言 ({t.commentCount})
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>

                {(t.status === 'PRIVATE' || t.status === 'REJECTED') && (
                  <button
                    type="button"
                    disabled={uploadingId === t.id}
                    onClick={() => triggerUploadFor(t.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {uploadingId === t.id ? '上传中...' : '补传照片申请公开'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelected}
        className="hidden"
      />
    </div>
  );
}
