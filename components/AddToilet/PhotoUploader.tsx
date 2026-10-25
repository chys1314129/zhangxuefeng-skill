'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { compressImage } from '@/lib/imageUtils';

interface PhotoUploaderProps {
  photos: File[];
  onChange: (files: File[]) => void;
  maxCount?: number;
}

export default function PhotoUploader({
  photos,
  onChange,
  maxCount = 3,
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    const urls = photos.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [photos]);

  const appendImageFiles = useCallback(
    async (incoming: File[]) => {
      const imageFiles = incoming.filter((f) => f.type.startsWith('image/'));
      if (!imageFiles.length) return;

      const remain = maxCount - photos.length;
      if (remain <= 0) {
        toast.error(`最多只能上传 ${maxCount} 张照片`);
        return;
      }

      setCompressing(true);
      try {
        const slice = imageFiles.slice(0, remain);
        const compressed = await Promise.all(
          slice.map((file) =>
            compressImage(file, { maxWidth: 1200, quality: 0.82 })
          )
        );
        onChange([...photos, ...compressed]);
      } catch {
        toast.error('图片处理失败，请重试');
      } finally {
        setCompressing(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [maxCount, onChange, photos]
  );

  // 电脑端支持直接 Ctrl+V / Cmd+V 粘贴截图上传
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      const items = Array.from(e.clipboardData?.items || []);
      const imgFiles = items
        .filter((it) => it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter(Boolean) as File[];
      if (imgFiles.length > 0) {
        e.preventDefault();
        appendImageFiles(imgFiles);
        toast.success('已从剪贴板导入图片');
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [appendImageFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    appendImageFiles(selected);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    appendImageFiles(dropped);
  };

  const removeAt = (idx: number) => {
    const next = [...photos];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`rounded-xl transition ${
        dragActive ? 'ring-2 ring-blue-500 bg-blue-50/40 p-2' : ''
      }`}
    >
      <div className="grid grid-cols-3 gap-3">
        {previews.map((url, idx) => (
          <div
            key={`${url}-${idx}`}
            className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100 group"
          >
            <img
              src={url}
              alt={`已选照片 ${idx + 1}`}
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => removeAt(idx)}
              aria-label="移除照片"
              className="absolute top-1.5 right-1.5 bg-black/65 hover:bg-black/85 text-white rounded-full p-1.5 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {photos.length < maxCount && (
          <button
            type="button"
            disabled={compressing}
            onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 flex flex-col items-center justify-center gap-1.5 text-slate-500 hover:text-blue-600 transition px-2 text-center"
          >
            <Camera className="w-6 h-6 md:hidden" />
            <UploadCloud className="w-6 h-6 hidden md:block" />
            <span className="text-xs font-medium leading-tight">
              {compressing
                ? '压缩中...'
                : `拍照/选图 (${photos.length}/${maxCount})`}
            </span>
            <span className="hidden md:block text-[10px] text-slate-400">
              支持拖拽或 Ctrl+V
            </span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
