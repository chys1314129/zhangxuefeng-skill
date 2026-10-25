'use client';

import { useEffect } from 'react';
import { Copy, ExternalLink, Navigation, X } from 'lucide-react';
import { toast } from 'sonner';
import { estimateWalkMinutes, formatDistance } from '@/lib/geo';
import { buildAMapWalkUrl, buildTencentWalkUrl } from '@/lib/mapService';
import type { ToiletItem } from '@/types';

interface NavigationModalProps {
  toilet: ToiletItem | null;
  userLocation?: { lng: number; lat: number } | null;
  onClose: () => void;
}

export default function NavigationModal({
  toilet,
  userLocation,
  onClose,
}: NavigationModalProps) {
  useEffect(() => {
    if (!toilet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toilet, onClose]);

  if (!toilet) return null;

  const amapUrl = buildAMapWalkUrl({
    toLng: toilet.lng,
    toLat: toilet.lat,
    toName: toilet.name,
    fromLng: userLocation?.lng,
    fromLat: userLocation?.lat,
  });

  const tmapUrl = buildTencentWalkUrl({
    toLng: toilet.lng,
    toLat: toilet.lat,
    toName: toilet.name,
    fromLng: userLocation?.lng,
    fromLat: userLocation?.lat,
  });

  const handleCopyAddress = async () => {
    const text = `${toilet.name}${toilet.floor ? ` (${toilet.floor})` : ''} - ${
      toilet.address || `${toilet.lng},${toilet.lat}`
    }`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制位置信息');
    } catch {
      toast.info(text);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-5 pb-8 md:pb-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full mb-1.5">
              <Navigation className="w-3.5 h-3.5" />
              步行导航前往
            </div>
            <h3 className="text-lg font-bold text-slate-900 leading-snug">
              {toilet.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 rounded-xl p-3.5 mb-4 space-y-1.5 text-sm">
          {toilet.distance !== undefined && (
            <div className="flex items-center gap-2 text-slate-700 font-medium flex-wrap">
              <span>🚶 直线距离 {formatDistance(toilet.distance)}</span>
              <span className="text-slate-300">·</span>
              <span className="text-blue-600">
                预计步行约 {estimateWalkMinutes(toilet.distance)} 分钟
              </span>
            </div>
          )}
          {toilet.floor && (
            <div className="text-slate-600">
              🏢 楼层提示：
              <strong className="text-slate-800">{toilet.floor}</strong>
            </div>
          )}
          {toilet.description && (
            <div className="text-slate-600 text-xs leading-relaxed">
              💡 找路指引：{toilet.description}
            </div>
          )}
          {toilet.address && (
            <div className="text-slate-400 text-xs break-words">
              📍 {toilet.address}
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <a
            href={amapUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition shadow-xs"
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🗺️</span>
              打开高德地图 · 步行路线规划
            </span>
            <ExternalLink className="w-4 h-4 opacity-80" />
          </a>

          <a
            href={tmapUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition shadow-xs"
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🧭</span>
              打开腾讯地图 · 步行路线规划
            </span>
            <ExternalLink className="w-4 h-4 opacity-80" />
          </a>

          <button
            type="button"
            onClick={handleCopyAddress}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm transition"
          >
            <Copy className="w-4 h-4" />
            复制详细地址与楼层指引
          </button>
        </div>
      </div>
    </div>
  );
}
