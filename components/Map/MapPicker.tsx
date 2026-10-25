'use client';

import { useEffect, useState } from 'react';
import { Crosshair, Maximize2, Minimize2, Search } from 'lucide-react';
import InteractiveMap from '@/components/Map/InteractiveMap';
import { useUserLocation } from '@/hooks/useUserLocation';
import { reverseGeocodeClient, searchPlaceClient } from '@/lib/mapService';

interface MapPickerProps {
  initialCenter?: [number, number];
  onLocationChange: (lng: number, lat: number, address: string) => void;
}

export default function MapPicker({
  initialCenter = [116.397428, 39.90923],
  onLocationChange,
}: MapPickerProps) {
  const { location } = useUserLocation();
  const [center, setCenter] = useState<[number, number]>(initialCenter);
  const [mapViewCenter, setMapViewCenter] =
    useState<[number, number]>(initialCenter);
  const [picked, setPicked] = useState<[number, number]>(initialCenter);
  const [resolvingAddr, setResolvingAddr] = useState(false);
  const [searchKw, setSearchKw] = useState('');
  const [searching, setSearching] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const updatePoint = async (lng: number, lat: number, moveCenter = false) => {
    const fixedLng = Number(lng.toFixed(6));
    const fixedLat = Number(lat.toFixed(6));
    setPicked([fixedLng, fixedLat]);
    if (moveCenter) {
      setCenter([fixedLng, fixedLat]);
      setMapViewCenter([fixedLng, fixedLat]);
    }
    setResolvingAddr(true);
    const addr = await reverseGeocodeClient(fixedLng, fixedLat);
    setResolvingAddr(false);
    onLocationChange(fixedLng, fixedLat, addr);
  };

  useEffect(() => {
    if (location?.inChina) {
      updatePoint(location.lng, location.lat, true);
    } else {
      updatePoint(initialCenter[0], initialCenter[1], false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.inChina]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const handlePlaceSearch = async () => {
    if (!searchKw.trim()) return;
    setSearching(true);
    const list = await searchPlaceClient(searchKw, center[0], center[1]);
    setSearching(false);
    if (list.length > 0) {
      const first = list[0];
      setPicked([first.lng, first.lat]);
      setCenter([first.lng, first.lat]);
      setMapViewCenter([first.lng, first.lat]);
      onLocationChange(
        first.lng,
        first.lat,
        first.address ? `${first.name} (${first.address})` : first.name
      );
    }
  };

  const mapContent = (isModal: boolean) => (
    <div
      className={
        isModal
          ? 'fixed inset-0 z-50 bg-white flex flex-col'
          : 'relative h-60 md:h-80 lg:h-[360px] w-full rounded-xl overflow-hidden border border-slate-200 shadow-inner'
      }
    >
      {isModal && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
          <span className="text-sm font-bold text-slate-800">
            📍 点击地图或拖动红标选择精确位置
          </span>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
          >
            确认选点
          </button>
        </div>
      )}

      <div className="relative flex-1 w-full h-full">
        <InteractiveMap
          center={center}
          zoom={16}
          pickerMode
          pickedPoint={picked}
          userLocation={location}
          showZoomControls
          zoomControlPosition="bottom-right"
          onMoveEnd={(lng, lat) => setMapViewCenter([lng, lat])}
          onPickLocation={(lng, lat) => updatePoint(lng, lat, false)}
        />

        {/* 左上提示 */}
        <div className="absolute top-2.5 left-2.5 z-20 bg-black/65 text-white text-[11px] px-2.5 py-1 rounded-full backdrop-blur-sm pointer-events-none">
          {resolvingAddr
            ? '正在解析街道地址...'
            : '鼠标点击 / 手指轻触地图，或拖动红标微调'}
        </div>

        {/* 右上全屏切换按钮 */}
        <button
          type="button"
          onClick={() => setFullscreen(!isModal)}
          title={isModal ? '退出全屏' : '全屏大图选点'}
          className="absolute top-2.5 right-2.5 z-20 bg-white/95 hover:bg-white px-2.5 py-1.5 rounded-lg shadow-md border border-slate-200 text-slate-700 text-xs font-medium inline-flex items-center gap-1"
        >
          {isModal ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" />
              收起
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" />
              全屏选点
            </>
          )}
        </button>

        {/* 左下快捷操作：设为视野中心 + 回到我的定位 */}
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={() => updatePoint(mapViewCenter[0], mapViewCenter[1], false)}
            className="bg-white/95 hover:bg-white px-2.5 py-1.5 rounded-lg shadow-md border border-slate-200 text-slate-700 text-xs font-medium"
          >
            📌 选在视野中心
          </button>

          {location && (
            <button
              type="button"
              onClick={() => updatePoint(location.lng, location.lat, true)}
              title="定位到我的位置"
              className="bg-white/95 hover:bg-white p-2 rounded-lg shadow-md border border-slate-200 text-blue-600"
            >
              <Crosshair className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-2.5">
      {/* 搜索定位栏 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchKw}
            onChange={(e) => setSearchKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handlePlaceSearch();
              }
            }}
            placeholder="搜地标快速跳转（如：三里屯、人民广场）"
            className="w-full pl-9 pr-3 py-2 text-xs md:text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={handlePlaceSearch}
          disabled={searching}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold whitespace-nowrap transition"
        >
          {searching ? '定位中...' : '搜索跳转'}
        </button>
      </div>

      {mapContent(false)}
      {fullscreen && mapContent(true)}
    </div>
  );
}
