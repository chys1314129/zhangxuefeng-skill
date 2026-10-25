'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  Crosshair,
  List,
  MapPin,
  MessageSquare,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Star,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import InteractiveMap from '@/components/Map/InteractiveMap';
import NearestToiletCard from '@/components/Map/NearestToiletCard';
import ToiletListDrawer from '@/components/Map/ToiletListDrawer';
import NavigationModal from '@/components/Toilet/NavigationModal';
import { useAuth } from '@/hooks/useAuth';
import { ToiletFilters, useToilets } from '@/hooks/useToilets';
import { useUserLocation } from '@/hooks/useUserLocation';
import {
  CITY_HOTSPOTS,
  estimateWalkMinutes,
  formatDistance,
} from '@/lib/geo';
import { PlaceSuggestion, searchPlaceClient } from '@/lib/mapService';
import type { MapEngineType, ToiletItem } from '@/types';

const DEFAULT_CENTER: [number, number] = [116.397428, 39.90923]; // 北京天安门/王府井

function MapHomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { location, requestLocation } = useUserLocation();

  const initialLng = parseFloat(searchParams.get('lng') || '');
  const initialLat = parseFloat(searchParams.get('lat') || '');

  const [mapCenter, setMapCenter] = useState<[number, number]>(
    Number.isFinite(initialLng) && Number.isFinite(initialLat)
      ? [initialLng, initialLat]
      : DEFAULT_CENTER
  );
  const [queryCenter, setQueryCenter] = useState<[number, number]>(mapCenter);
  const [engine, setEngine] = useState<MapEngineType>('amap');

  const [filters, setFilters] = useState<ToiletFilters>({});
  const [selectedToilet, setSelectedToilet] = useState<ToiletItem | null>(null);
  const [hoveredToiletId, setHoveredToiletId] = useState<string | null>(null);
  const [navTarget, setNavTarget] = useState<ToiletItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hotspotOpen, setHotspotOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);

  const desktopSearchRef = useRef<HTMLInputElement>(null);

  // 电脑端快捷键支持：按 `/` 聚焦搜索框，按 `Esc` 收起下拉菜单
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === '/' && !inInput) {
        if (window.innerWidth >= 768 && sidebarOpen) {
          e.preventDefault();
          desktopSearchRef.current?.focus();
        }
      } else if (e.key === 'Escape') {
        setSuggestions([]);
        setHotspotOpen(false);
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  // 首次若真实定位在国内，自动切到用户当前位置
  const [autoCenteredUser, setAutoCenteredUser] = useState(false);
  useEffect(() => {
    if (
      !autoCenteredUser &&
      location?.inChina &&
      !Number.isFinite(initialLng)
    ) {
      setAutoCenteredUser(true);
      setMapCenter([location.lng, location.lat]);
      setQueryCenter([location.lng, location.lat]);
    }
  }, [location, autoCenteredUser, initialLng]);

  const { toilets, nearest, isLoading } = useToilets({
    lng: queryCenter[0],
    lat: queryCenter[1],
    radius: 3000,
    filters,
  });

  const activeCardToilet =
    (selectedToilet && toilets.find((t) => t.id === selectedToilet.id)) ||
    nearest;

  const handleSearchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = searchInput.trim();
    if (!kw) {
      setFilters((f) => ({ ...f, keyword: '' }));
      setSuggestions([]);
      return;
    }

    setSearchingPlace(true);
    const places = await searchPlaceClient(kw);
    setSearchingPlace(false);

    if (places.length > 0) {
      setSuggestions(places);
    } else {
      setFilters((f) => ({ ...f, keyword: kw }));
      toast.info(`正在当前区域筛选包含「${kw}」的厕所`);
    }
  };

  const clearSearch = () => {
    setSearchInput('');
    setSuggestions([]);
    setFilters((f) => ({ ...f, keyword: '' }));
  };

  const jumpToPlace = (lng: number, lat: number, label?: string) => {
    setMapCenter([lng, lat]);
    setQueryCenter([lng, lat]);
    setSelectedToilet(null);
    setSuggestions([]);
    setHotspotOpen(false);
    if (label) {
      toast.success(`已切换至：${label}`);
    }
  };

  const handleUrgentClick = () => {
    if (!nearest) {
      toast.error('当前视野暂无可用厕所，请缩小地图或切换商圈');
      return;
    }
    setSelectedToilet(nearest);
    setMapCenter([nearest.lng, nearest.lat]);
    setNavTarget(nearest);
  };

  const handleLocateMe = () => {
    if (location) {
      setMapCenter([location.lng, location.lat]);
      setQueryCenter([location.lng, location.lat]);
      if (!location.inChina) {
        toast.info(
          '已定位到您当前的海外坐标（中国境内公厕数据最丰富，可通过热门商圈一键切换体验）'
        );
      } else {
        toast.success('已回到您的当前位置');
      }
    } else {
      requestLocation();
      toast.info('正在请求浏览器定位权限...');
    }
  };

  const toggleFilter = (key: keyof ToiletFilters) => {
    if (key === 'onlyMine' && !user) {
      toast('登录后可查看自己添加的私人厕所标记', {
        action: {
          label: '去登录',
          onClick: () => router.push('/login'),
        },
      });
      return;
    }
    setFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="relative flex h-[calc(100dvh-3.5rem)] w-full overflow-hidden select-none">
      {/* ==================== 电脑端左侧固定可折叠侧边栏 (md 及以上显示) ==================== */}
      {sidebarOpen && (
        <aside className="hidden md:flex flex-col w-[360px] lg:w-[400px] shrink-0 h-full bg-white border-r border-slate-200 z-30 shadow-xs">
          {/* 侧边栏头部：搜索 + 热门城市 + 筛选 */}
          <div className="p-3.5 border-b border-slate-100 space-y-3">
            {/* 搜索框 */}
            <form onSubmit={handleSearchPlace} className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={desktopSearchRef}
                type="text"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  if (!e.target.value.trim()) {
                    setSuggestions([]);
                    setFilters((f) => ({ ...f, keyword: '' }));
                  }
                }}
                placeholder="搜地点/商场/地铁站 (按 / 快捷聚焦)"
                className="w-full h-10 pl-9 pr-16 bg-slate-50 hover:bg-slate-100/70 focus:bg-white rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-12 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                disabled={searchingPlace}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
              >
                {searchingPlace ? '...' : '搜索'}
              </button>

              {/* 桌面端搜索联想 */}
              {suggestions.length > 0 && (
                <div className="absolute top-11 left-0 right-0 bg-white rounded-xl shadow-xl border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto z-50">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSearchInput(s.name);
                        jumpToPlace(s.lng, s.lat, s.name);
                      }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 transition"
                    >
                      <div className="text-xs font-semibold text-slate-800">
                        {s.name}
                      </div>
                      {s.address && (
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {s.address}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </form>

            {/* 热门商圈快捷标签 */}
            <div className="flex items-center gap-1.5 overflow-x-auto desktop-scrollbar pb-0.5">
              {CITY_HOTSPOTS.map((spot) => (
                <button
                  key={spot.name}
                  type="button"
                  onClick={() => jumpToPlace(spot.lng, spot.lat, spot.name)}
                  className="shrink-0 text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 font-medium transition"
                >
                  {spot.name.split('·')[1] || spot.name}
                </button>
              ))}
            </div>

            {/* 属性筛选芯片 */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => toggleFilter('isFree')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                  filters.isFree
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                🆓 免费
              </button>
              <button
                type="button"
                onClick={() => toggleFilter('hasPaper')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                  filters.hasPaper
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                🧻 有纸
              </button>
              <button
                type="button"
                onClick={() => toggleFilter('hasAccessible')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                  filters.hasAccessible
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                ♿ 无障碍
              </button>
              <button
                type="button"
                onClick={() => toggleFilter('onlyMine')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                  filters.onlyMine
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                🔒 我的标记
              </button>
            </div>
          </div>

          {/* 列表统计与标题 */}
          <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700">
              周边共找到 <strong className="text-blue-600">{toilets.length}</strong> 个厕所
            </span>
            <span className="text-slate-400">按距离由近到远</span>
          </div>

          {/* 可滚动厕所列表（悬停联动高亮右侧地图标记） */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 desktop-scrollbar">
            {isLoading && toilets.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                正在检索附近公共厕所...
              </div>
            ) : toilets.length === 0 ? (
              <div className="py-16 px-6 text-center space-y-3">
                <div className="text-3xl">🗺️</div>
                <p className="text-sm text-slate-500">
                  当前地图视野内暂无符合筛选的厕所
                </p>
                <Link
                  href={`/add?lng=${queryCenter[0].toFixed(6)}&lat=${queryCenter[1].toFixed(6)}`}
                  className="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold"
                >
                  + 在当前位置添加厕所
                </Link>
              </div>
            ) : (
              toilets.map((t, index) => {
                const isSelected = activeCardToilet?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onMouseEnter={() => setHoveredToiletId(t.id)}
                    onMouseLeave={() => setHoveredToiletId(null)}
                    onClick={() => {
                      setSelectedToilet(t);
                      setMapCenter([t.lng, t.lat]);
                    }}
                    className={`p-3.5 cursor-pointer transition border-l-4 ${
                      isSelected
                        ? 'bg-blue-50/60 border-l-blue-600'
                        : 'bg-white hover:bg-slate-50 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          {index === 0 && (
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
                          {t.floor && (
                            <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                              {t.floor}
                            </span>
                          )}
                          <h4 className="font-bold text-slate-900 text-sm truncate">
                            {t.name}
                          </h4>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                          {t.distance !== undefined && (
                            <span className="text-blue-600 font-semibold">
                              {formatDistance(t.distance)} · 步行约
                              {estimateWalkMinutes(t.distance)}分钟
                            </span>
                          )}
                          {t.avgRating > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-amber-500 font-medium">
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
                          {t.hasPaper === false && (
                            <span className="text-[11px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">
                              需自备纸
                            </span>
                          )}
                          {t.hasAccessible && (
                            <span className="text-[11px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">
                              无障碍
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-slate-100">
                      <Link
                        href={`/toilet/${t.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                        详情与留言 ({t.commentCount})
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNavTarget(t);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        步行导航
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* ==================== 右侧（手机端全屏）交互式地图主画布 ==================== */}
      <div className="relative flex-1 h-full overflow-hidden">
        <InteractiveMap
          center={mapCenter}
          zoom={15}
          engine={engine}
          userLocation={location}
          toilets={toilets}
          nearestId={nearest?.id || null}
          selectedId={activeCardToilet?.id || null}
          hoveredId={hoveredToiletId}
          showZoomControls
          zoomControlPosition="bottom-left"
          onEngineFallback={(nextEngine, msg) => {
            setEngine(nextEngine);
            if (msg) toast.info(msg);
          }}
          onMoveEnd={(lng, lat) => {
            setQueryCenter([lng, lat]);
          }}
          onSelectToilet={(t) => {
            if (selectedToilet?.id === t.id) {
              router.push(`/toilet/${t.id}`);
            } else {
              setSelectedToilet(t);
            }
          }}
        />

        {/* 电脑端：侧边栏展开/收起切换按钮 + 顶部地图工具条 */}
        <div className="hidden md:flex items-center justify-between absolute top-3.5 left-3.5 right-3.5 z-30 pointer-events-none">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="pointer-events-auto h-10 px-3 bg-white/95 hover:bg-white backdrop-blur-md rounded-xl shadow-md border border-slate-200/90 flex items-center gap-1.5 text-xs font-semibold text-slate-700 transition"
          >
            {sidebarOpen ? (
              <>
                <PanelLeftClose className="w-4 h-4 text-slate-500" />
                收起列表
              </>
            ) : (
              <>
                <PanelLeftOpen className="w-4 h-4 text-blue-600" />
                展开列表 ({toilets.length})
              </>
            )}
          </button>

          {/* 电脑端右上工具栏：紧急找厕 + 定位 + 在此添加 + 高德/腾讯切换 */}
          <div className="pointer-events-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleUrgentClick}
              className="h-10 px-4 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-extrabold shadow-lg shadow-red-500/30 flex items-center gap-1.5 animate-pulse-fast transition"
            >
              <span>🚽</span>
              <span>急！导航去最近厕所</span>
            </button>

            <button
              type="button"
              onClick={handleLocateMe}
              className="h-10 px-3 bg-white/95 hover:bg-white backdrop-blur-md rounded-xl shadow-md border border-slate-200/90 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition"
            >
              <Crosshair className="w-4 h-4 text-blue-600" />
              我的定位
            </button>

            <Link
              href={`/add?lng=${queryCenter[0].toFixed(6)}&lat=${queryCenter[1].toFixed(6)}`}
              className="h-10 px-3 bg-white/95 hover:bg-white backdrop-blur-md rounded-xl shadow-md border border-slate-200/90 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition"
            >
              <Plus className="w-4 h-4 text-blue-600" />
              在此添加
            </Link>

            <div className="h-10 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200/90 p-1 flex items-center text-xs font-semibold">
              <button
                type="button"
                onClick={() => setEngine('amap')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  engine === 'amap' || engine === 'leaflet'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                高德地图
              </button>
              <button
                type="button"
                onClick={() => setEngine('tmap')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  engine === 'tmap'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                腾讯地图
              </button>
            </div>
          </div>
        </div>

        {/* 电脑端地图右下角选中点位预览卡 */}
        {activeCardToilet && (
          <div className="hidden md:block absolute bottom-5 right-5 z-30 w-[360px]">
            <NearestToiletCard
              toilet={activeCardToilet}
              isNearest={nearest?.id === activeCardToilet.id}
              onNavigate={(t) => setNavTarget(t)}
            />
          </div>
        )}

        {/* ==================== 手机端专属悬浮控件 (< md 显示) ==================== */}
        <div className="md:hidden absolute top-3 left-3 right-3 z-30 space-y-2 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="relative">
              <button
                type="button"
                onClick={() => setHotspotOpen((v) => !v)}
                className="h-10 px-2.5 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200/80 flex items-center gap-1 text-xs font-bold text-slate-800"
              >
                <span>🚽</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {hotspotOpen && (
                <div className="absolute top-12 left-0 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50">
                  <div className="px-3 py-1 text-[11px] font-semibold text-slate-400">
                    快速切换城市商圈
                  </div>
                  {CITY_HOTSPOTS.map((spot) => (
                    <button
                      key={spot.name}
                      type="button"
                      onClick={() => jumpToPlace(spot.lng, spot.lat, spot.name)}
                      className="w-full text-left px-3 py-2.5 text-xs text-slate-700 active:bg-blue-50 flex items-center gap-1.5"
                    >
                      <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="truncate">{spot.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 手机搜索框 */}
            <form onSubmit={handleSearchPlace} className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  if (!e.target.value.trim()) {
                    setSuggestions([]);
                    setFilters((f) => ({ ...f, keyword: '' }));
                  }
                }}
                placeholder="搜地点找附近厕所..."
                className="w-full h-10 pl-9 pr-8 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200/80 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {suggestions.length > 0 && (
                <div className="absolute top-12 left-0 right-0 bg-white rounded-xl shadow-xl border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto z-50">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSearchInput(s.name);
                        jumpToPlace(s.lng, s.lat, s.name);
                      }}
                      className="w-full text-left px-3.5 py-2.5 active:bg-blue-50"
                    >
                      <div className="text-xs font-semibold text-slate-800">
                        {s.name}
                      </div>
                      {s.address && (
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {s.address}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </form>

            {/* 手机高德/腾讯切换 */}
            <div className="h-10 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200/80 p-1 flex items-center text-[11px] font-semibold shrink-0">
              <button
                type="button"
                onClick={() => setEngine('amap')}
                className={`px-2 py-1.5 rounded-lg transition ${
                  engine === 'amap' || engine === 'leaflet'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600'
                }`}
              >
                高德
              </button>
              <button
                type="button"
                onClick={() => setEngine('tmap')}
                className={`px-2 py-1.5 rounded-lg transition ${
                  engine === 'tmap'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600'
                }`}
              >
                腾讯
              </button>
            </div>
          </div>

          {/* 手机快捷筛选胶囊 */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pointer-events-auto pb-0.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-900 text-white shadow-sm"
            >
              <List className="w-3.5 h-3.5" />
              附近 {isLoading ? '...' : toilets.length} 个
            </button>

            <button
              type="button"
              onClick={() => toggleFilter('isFree')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-xs border ${
                filters.isFree
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white/95 text-slate-700 border-slate-200/80'
              }`}
            >
              🆓 免费
            </button>

            <button
              type="button"
              onClick={() => toggleFilter('hasPaper')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-xs border ${
                filters.hasPaper
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white/95 text-slate-700 border-slate-200/80'
              }`}
            >
              🧻 有纸
            </button>

            <button
              type="button"
              onClick={() => toggleFilter('hasAccessible')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-xs border ${
                filters.hasAccessible
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white/95 text-slate-700 border-slate-200/80'
              }`}
            >
              ♿ 无障碍
            </button>

            <button
              type="button"
              onClick={() => toggleFilter('onlyMine')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-xs border ${
                filters.onlyMine
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white/95 text-slate-700 border-slate-200/80'
              }`}
            >
              🔒 我的标记
            </button>
          </div>
        </div>

        {/* 手机端右侧大拇指热区悬浮按钮 */}
        <div className="md:hidden absolute right-3.5 bottom-48 z-30 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleUrgentClick}
            className="w-14 h-14 rounded-full bg-red-500 active:scale-95 text-white shadow-xl shadow-red-500/35 border-2 border-white flex flex-col items-center justify-center leading-tight animate-pulse-fast"
          >
            <span className="text-base">🚽</span>
            <span className="text-xs font-extrabold">急！</span>
          </button>

          <button
            type="button"
            onClick={handleLocateMe}
            aria-label="定位到我的位置"
            className="w-11 h-11 rounded-full bg-white/95 text-slate-700 shadow-lg border border-slate-200 flex items-center justify-center active:scale-95"
          >
            <Crosshair className="w-5 h-5 text-blue-600" />
          </button>

          <Link
            href={`/add?lng=${queryCenter[0].toFixed(6)}&lat=${queryCenter[1].toFixed(6)}`}
            aria-label="在此添加厕所"
            className="w-11 h-11 rounded-full bg-blue-600 text-white shadow-lg border border-white flex items-center justify-center active:scale-95"
          >
            <Plus className="w-5 h-5" />
          </Link>
        </div>

        {/* 手机端底部卡片 */}
        <div className="md:hidden absolute bottom-3 left-3 right-3 z-30">
          {activeCardToilet ? (
            <NearestToiletCard
              toilet={activeCardToilet}
              isNearest={nearest?.id === activeCardToilet.id}
              onNavigate={(t) => setNavTarget(t)}
            />
          ) : (
            <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg border border-slate-200 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {isLoading
                    ? '正在搜索周围公厕...'
                    : '附近 3km 暂未收录符合条件的厕所'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  发现新厕所？点击右侧加号随手标记
                </p>
              </div>
              <Link
                href={`/add?lng=${queryCenter[0].toFixed(6)}&lat=${queryCenter[1].toFixed(6)}`}
                className="px-3.5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl shrink-0"
              >
                + 添加
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* 手机端底部列表抽屉 */}
      <ToiletListDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        toilets={toilets}
        onSelect={(t) => {
          setSelectedToilet(t);
          setMapCenter([t.lng, t.lat]);
        }}
        onNavigate={(t) => {
          setDrawerOpen(false);
          setNavTarget(t);
        }}
      />

      {/* 步行导航弹窗 */}
      <NavigationModal
        toilet={navTarget}
        userLocation={location}
        onClose={() => setNavTarget(null)}
      />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="h-[calc(100dvh-3.5rem)] flex items-center justify-center text-slate-500 text-sm">
          正在加载地图...
        </div>
      }
    >
      <MapHomeContent />
    </Suspense>
  );
}
