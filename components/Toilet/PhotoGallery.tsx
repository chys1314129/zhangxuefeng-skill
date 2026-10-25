'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { compressImage } from '@/lib/imageUtils';
import type { ToiletPhotoItem, ToiletStatus } from '@/types';

interface PhotoGalleryProps {
  toiletId: string;
  status: ToiletStatus;
  isOwn?: boolean;
  photos: ToiletPhotoItem[];
  onUploaded?: () => void;
}

export default function PhotoGallery({
  toiletId,
  status,
  isOwn,
  photos,
  onUploaded,
}: PhotoGalleryProps) {
  const { user, authFetch } = useAuth();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxUrl]);

  const canUpload =
    Boolean(user) &&
    (status === 'PUBLIC' || isOwn || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN');

  const handleSupplementUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploading(true);
    try {
      const formData = new FormData();
      for (const f of files.slice(0, 3)) {
        const compressed = await compressImage(f);
        formData.append('photos', compressed);
      }

      const res = await authFetch(`/api/v1/toilets/${toiletId}/photos`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.code === 200) {
        toast.success(json.data?.message || '照片上传成功');
        onUploaded?.();
      } else {
        toast.error(json.message || '上传失败');
      }
    } catch {
      toast.error('上传照片失败，请重试');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {photos.length > 0 ? (
        <div
          className={`grid gap-2 ${
            photos.length === 1
              ? 'grid-cols-1'
              : photos.length === 2
                ? 'grid-cols-2'
                : 'grid-cols-3'
          }`}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              onClick={() => setLightboxUrl(p.photoUrl)}
              className="relative group rounded-xl overflow-hidden bg-slate-100 border border-slate-200 cursor-pointer h-44"
            >
              <img
                src={p.photoUrl}
                alt="厕所实景图"
                className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
              />
              <div className="absolute bottom-2 right-2 bg-black/50 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition">
                <ZoomIn className="w-3.5 h-3.5" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-slate-100 border border-dashed border-slate-300 py-8 px-4 text-center">
          <div className="text-3xl mb-1.5">📷</div>
          <p className="text-sm text-slate-600 font-medium">暂无实景照片</p>
          {status === 'PRIVATE' && isOwn && (
            <p className="text-xs text-purple-600 mt-1">
              当前仅你自己可见 · 补充照片后即可提交审核对所有人公开！
            </p>
          )}
        </div>
      )}

      {canUpload && (
        <div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold transition ${
              status === 'PRIVATE' || status === 'REJECTED'
                ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Camera className="w-4 h-4" />
            {uploading
              ? '正在上传...'
              : status === 'PRIVATE'
                ? '📸 补拍实景照片 · 申请转为公开厕所'
                : status === 'REJECTED'
                  ? '📸 重新上传照片 · 再次提交审核'
                  : '补充上传实景图'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleSupplementUpload}
            className="hidden"
          />
        </div>
      )}

      {/* 大图预览弹窗 */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white bg-white/15 hover:bg-white/25 rounded-full p-2"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt="放大预览"
            className="max-w-full max-h-[85vh] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
