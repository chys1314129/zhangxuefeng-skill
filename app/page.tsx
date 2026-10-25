'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  RefreshCw,
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
import {
  LocationAccuracyLevel,
  readPreferredInitialView,
  saveMapViewport,
  useUserLocation,
} from '@/hooks/useUserLocation';
import {
  CITY_HOTSPOTS,
  estimateWalkMinutes,
  formatDistance,
} from '@/lib/geo';
import { PlaceSuggestion, searchPlaceClient } from '@/lib/mapService';
import type { MapBounds, ToiletItem } from '@/types';

const FALLBACK_CENTER: [number, number] = [116.397428, 39.90923];
const GENERIC_TOILET_QUERY_RE = /^(公共)?(厕所|公厕|洗手间|卫生间|wc|toilet)$/i;
const ACCURACY_SCORE: Record<LocationAccuracyLevel, number> = {
  ip: 1,
  network: 2,
  gps: 3,
};

function MapHomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { location, loading: locating, requestLocation } = useUserLocation();

  const initialLng = parseFloat(searchParams.get('lng') || '');
  const initialLat = parseFloat(searchParams.get('lat') || '');
  const hasUrlCoords =
    Number.isFinite(initialLng) && Number.isFinite(initialLat);

  const [mapCenter, setMapCenter] = useState<[number, number]>(
    hasUrlCoords ? [initialLng, initialLat] : FALLBACK_CENTER
  );
  const [queryCenter, setQueryCenter] = useState<[number, number]>(
    hasUrlCoords ? [initialLng, initialLat] : FALLBACK_CENTER
  );
  const [mapZoom, setMapZoom] = useState<number>(15);
  const [flyVersion, setFlyVersion] = useState<number>(0);
  const [viewportBounds, setViewportBounds] = useState<MapBounds | null>(null);

  const mapZoomRef = useRef<number>(15);
  mapZoomRef.current = mapZoom;

  // 标记是否已脱离初始兜底点（防止未完成定位前把兜底北京坐标误写入会话缓存）
  const hasRealPositionRef = useRef<boolean>(hasUrlCoords);
  // 标记用户是否已在当前会话恢复了浏览视野或主动拖拽/搜索了地图
  const restoredSessionRef = useRef<boolean>(false);
  const userMovedMapRef = useRef<boolean>(hasUrlCoords);
  const appliedAccuracyRef = useRef<number>(0);

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

  const flyTo = useCallback(
    (lng: number, lat: number, targetZoom?: number, persist = true) => {
      const nextZoom =
        typeof targetZoom === 'number' ? targetZoom : mapZoomRef.current;
      hasRealPositionRef.current = true;
      setMapCenter([lng, lat]);
      setQueryCenter([lng, lat]);
      setMapZoom(nextZoom);
      setFlyVersion((v) => v + 1);
      if (persist) {
        saveMapViewport(lng, lat, nextZoom);
      }
    },
    []
  );

  // 客户端挂载首帧：优先恢复会话视野或历史真实用户定位，杜绝切页返回或刷新后跳回北京
  useEffect(() => {
    if (hasUrlCoords) {
      hasRealPositionRef.current = true;
      userMovedMapRef.current = true;
      saveMapViewport(initialLng, initialLat, 16);
      return;
    }

    const saved = readPreferredInitialView();
    if (saved) {
      hasRealPositionRef.current = true;
      if (saved.source === 'session') {
        restoredSessionRef.current = true;
      }
      setMapCenter([saved.lng, saved.lat]);
      setQueryCenter([saved.lng, saved.lat]);
      setMapZoom(saved.zoom);
      setFlyVersion((v) => v + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当真实定位到达（先 IP 城市级、再 GPS/Wi-Fi 街道级）时，若用户尚未手动移图或恢复会话，自动锁定到用户真实位置
  useEffect(() => {
    if (!location || hasUrlCoords) return;

    const score = ACCURACY_SCORE[location.accuracy] || 1;
    if (
      !restoredSessionRef.current &&
      !userMovedMapRef.current &&
      score > appliedAccuracyRef.current
    ) {
      appliedAccuracyRef.current = score;
      const targetZoom = score >= 2 ? 16 : 14;
      flyTo(location.lng, location.lat, targetZoom, true);
    }
  }, [location, hasUrlCoords, flyTo]);

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

  const dynamicRadius = useMemo(() => {
    if (mapZoom >= 16) return 2800;
    if (mapZoom === 15) return 3800;
    if (mapZoom === 14) return 6000;
    return 9500;
  }, [mapZoom]);

  const {
    toilets,
    nearest,
    isLoading,
    isSyncingPois,
    refreshAreaPois,
  } = useToilets({
    lng: queryCenter[0],
    lat: queryCenter[1],
    radius: dynamicRadius,
    bounds: viewportBounds,
    filters,
  });

  const activeCardToilet =
    (selectedToilet && toilets.find((t) => t.id === selectedToilet.id)) ||
    nearest;

  const handleManualRefreshArea = async () => {
    const count = await refreshAreaPois();
    if (count > 0) {
      toast.success(`已从高德地图补全当前区域公厕（共扫描 ${count} 个点位）`);
    } else {
      toast.info('当前区域公厕已是最新数据');
    }
  };

  const handleSearchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = searchInput.trim();
    if (!kw) {
      setFilters((f) => ({ ...f, keyword: '' }));
      setSuggestions([]);
      return;
    }

    if (GENERIC_TOILET_QUERY_RE.test(kw)) {
      setFilters((f) => ({ ...f, keyword: '' }));
      setSuggestions([]);
      await handleManualRefreshArea();
      return;
    }

    setSearchingPlace(true);
    const places = await searchPlaceClient(kw, queryCenter[0], queryCenter[1]);
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
    userMovedMapRef.current = true;
    flyTo(lng, lat, 15, true);
    setSelectedToilet(null);
    setSuggestions([]);
    setHotspotOpen(false);
    if (label) {
      toast.success(`已切换至：${label}`);
    }
  };

  const handleUrgentClick = () => {
    if (!nearest) {
      toast.error('当前视野暂无可用厕所，请点击「刷新此区域」或缩小地图');
      return;
    }
    userMovedMapRef.current = true;
    setSelectedToilet(nearest);
    flyTo(nearest.lng, nearest.lat, Math.max(mapZoom, 16), true);
    setNavTarget(nearest);
  };

  const handleLocateMe = async () => {
    userMovedMapRef.current = false;
    restoredSessionRef.current = false;

    if (location) {
      flyTo(
        location.lng,
        location.lat,
        location.accuracy === 'ip' ? 14 : 16,
        true
      );
    } else {
      toast.info('正在获取您的当前位置...');
    }

    const fresh = await requestLocation(true);
    if (fresh) {
      appliedAccuracyRef.current = ACCURACY_SCORE[fresh.accuracy] || 1;
      flyTo(fresh.lng, fresh.lat, fresh.accuracy === 'ip' ? 14 : 16, true);
      if (fresh.accuracy === 'ip') {
        toast.info(
          `已按网络定位到${fresh.city ? `「${fresh.city}」` : '您所在城市'}（开启浏览器定位权限可精确到街道）`
        );
      } else {
        toast.success('已精准定位到您的当前位置');
      }
    } else if (!location) {
      toast.error('无法获取当前定位，请检查浏览器定位权限或直接搜索您所在位置');
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
        <aside className="hidden md:flex flex-col w-[360px] lg:w-[400px] shrink-0 h-full bg-white border-r border-slate-200 z-30 shadow-sm">
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
                placeholder="搜地点/商场/医院/公园 (按 / 快捷聚焦)"
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

          {/* 列表统计与同步状态 */}
          <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700">
              当前视野共{' '}
              <strong className="text-blue-600">{toilets.length}</strong> 个厕所
            </span>
            <span className="text-slate-400 flex items-center gap-1">
              {isSyncingPois ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
                  <span className="text-blue-600">正在同步高德公厕...</span>
                </>
              ) : (
                '按距离由近到远'
              )}
            </span>
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
                  {isSyncingPois
                    ? '正在从高德地图深度扫描当前区域公厕...'
                    : '当前地图视野内暂无符合筛选的厕所'}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleManualRefreshArea}
                    disabled={isSyncingPois}
                    className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isSyncingPois ? 'animate-spin' : ''}`}
                    />
                    重新扫描此区域
                  </button>
                  <Link
                    href={`/add?lng=${queryCenter[0].toFixed(6)}&lat=${queryCenter[1].toFixed(6)}`}
                    className="inline-block px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold"
                  >
                    + 在此添加厕所
                  </Link>
                </div>
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
                      userMovedMapRef.current = true;
                      setSelectedToilet(t);
                      flyTo(t.lng, t.lat, Math.max(mapZoom, 16), true);
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
                        高德导航
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* ==================== 右侧（手机端全屏）高德交互式地图主画布 ==================== */}
      <div className="relative flex-1 h-full overflow-hidden">
        <InteractiveMap
          center={mapCenter}
          zoom={mapZoom}
          flyVersion={flyVersion}
          userLocation={location}
          toilets={toilets}
          nearestId={nearest?.id || null}
          selectedId={activeCardToilet?.id || null}
          hoveredId={hoveredToiletId}
          showZoomControls
          zoomControlPosition="bottom-left"
          onMoveEnd={(lng, lat, z, b, isUserAction) => {
            setQueryCenter([lng, lat]);
            const nextZ = typeof z === 'number' ? z : mapZoomRef.current;
            if (typeof z === 'number') setMapZoom(z);
            if (b) setViewportBounds(b);
            if (isUserAction) {
              userMovedMapRef.current = true;
              hasRealPositionRef.current = true;
              saveMapViewport(lng, lat, nextZ);
            } else if (hasRealPositionRef.current) {
              saveMapViewport(lng, lat, nextZ);
            }
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

          {/* 电脑端右上工具栏：紧急找厕 + 刷新此区域 + 我的定位 + 在此添加 */}
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
              onClick={handleManualRefreshArea}
              disabled={isSyncingPois}
              title="重新扫描高德地图当前视野内的全部公厕"
              className="h-10 px-3 bg-white/95 hover:bg-white backdrop-blur-md rounded-xl shadow-md border border-slate-200/90 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-blue-600 ${
                  isSyncingPois ? 'animate-spin' : ''
                }`}
              />
              {isSyncingPois ? '扫描中...' : '刷新此区域'}
            </button>

            <button
              type="button"
              onClick={handleLocateMe}
              className="h-10 px-3 bg-white/95 hover:bg-white backdrop-blur-md rounded-xl shadow-md border border-slate-200/90 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition"
            >
              <Crosshair
                className={`w-4 h-4 text-blue-600 ${
                  locating && !location ? 'animate-spin' : ''
                }`}
              />
              {locating && !location ? '定位中...' : '我的定位'}
            </button>

            <Link
              href={`/add?lng=${queryCenter[0].toFixed(6)}&lat=${queryCenter[1].toFixed(6)}`}
              className="h-10 px-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md text-xs font-semibold inline-flex items-center gap-1 transition"
            >
              <Plus className="w-4 h-4" />
              在此添加
            </Link>
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

            {/* 手机端一键刷新当前视野公厕 */}
            <button
              type="button"
              onClick={handleManualRefreshArea}
              disabled={isSyncingPois}
              title="刷新当前区域公厕"
              className="h-10 px-3 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200/80 flex items-center gap-1 text-xs font-semibold text-slate-700 shrink-0 active:scale-95"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-blue-600 ${
                  isSyncingPois ? 'animate-spin' : ''
                }`}
              />
              <span>{isSyncingPois ? '扫描' : '刷新'}</span>
            </button>
          </div>

          {/* 手机快捷筛选胶囊 */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pointer-events-auto pb-0.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-900 text-white shadow-sm"
            >
              <List className="w-3.5 h-3.5" />
              附近 {isLoading && toilets.length === 0 ? '...' : toilets.length} 个
            </button>

            <button
              type="button"
              onClick={() => toggleFilter('isFree')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-sm border ${
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
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-sm border ${
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
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-sm border ${
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
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium shadow-sm border ${
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
            <Crosshair
              className={`w-5 h-5 text-blue-600 ${
                locating && !location ? 'animate-spin' : ''
              }`}
            />
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
                  {isLoading || isSyncingPois
                    ? '正在从高德地图扫描周围公厕...'
                    : '当前视野暂未收录符合条件的厕所'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  发现超市/医院/公园隐藏卫生间？点击右侧加号随手标记
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
          userMovedMapRef.current = true;
          setSelectedToilet(t);
          flyTo(t.lng, t.lat, Math.max(mapZoom, 16), true);
        }}
        onNavigate={(t) => {
          setDrawerOpen(false);
          setNavTarget(t);
        }}
      />

      {/* 高德步行导航弹窗 */}
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
