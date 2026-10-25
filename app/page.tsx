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
  ChevronUp,
  Compass,
  Crosshair,
  HelpCircle,
  List,
  MapPin,
  MessageSquare,
  Navigation,
  PanelLeftClose,
  RefreshCw,
  Search,
  SlidersHorizontal,
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
import {
  getInferredCategoryMeta,
  INFERRED_CATEGORY_LIST,
} from '@/lib/inferredVenues';
import { PlaceSuggestion, searchPlaceClient } from '@/lib/mapService';
import type { InferredCategory, MapBounds, ToiletItem } from '@/types';

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

  const hasRealPositionRef = useRef<boolean>(hasUrlCoords);
  const restoredSessionRef = useRef<boolean>(false);
  const userMovedMapRef = useRef<boolean>(hasUrlCoords);
  const appliedAccuracyRef = useRef<number>(0);

  const [filters, setFilters] = useState<ToiletFilters>({});
  // 「🧭 推测可借用」胶囊：500m 内已确认公厕 < 2 个时智能自动开启 + 用户可随时手动切换
  const [manualInferredChoice, setManualInferredChoice] = useState<
    boolean | null
  >(null);
  const [autoInferred, setAutoInferred] = useState<boolean>(false);
  const [inferredCategory, setInferredCategory] = useState<
    InferredCategory | 'ALL'
  >('ALL');
  const notifiedAutoInferredRef = useRef<boolean>(false);

  const effectiveIncludeInferred =
    manualInferredChoice !== null ? manualInferredChoice : autoInferred;
  const isAutoEnabledMode =
    manualInferredChoice === null && autoInferred === true;

  // 默认全屏纯净地图优先：列表栏、筛选面板、详情大卡片全部按需展开，不常驻遮挡地图
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hotspotOpen, setHotspotOpen] = useState(false);
  const [inferredTipOpen, setInferredTipOpen] = useState(false);
  const [isInteractingMap, setIsInteractingMap] = useState(false);

  const [selectedToilet, setSelectedToilet] = useState<ToiletItem | null>(null);
  const [hoveredToiletId, setHoveredToiletId] = useState<string | null>(null);
  const [navTarget, setNavTarget] = useState<ToiletItem | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const interactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 客户端挂载首帧：优先恢复会话视野或历史真实用户定位
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

  // 真实定位到达时锁定到用户位置
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

  // 快捷键支持：`/` 聚焦搜索框，`Esc` 关闭浮层与选中卡片
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === '/' && !inInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setSuggestions([]);
        setHotspotOpen(false);
        setFilterOpen(false);
        setInferredTipOpen(false);
        setDrawerOpen(false);
        setSelectedToilet(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const dynamicRadius = useMemo(() => {
    if (mapZoom >= 16) return 2800;
    if (mapZoom === 15) return 3800;
    if (mapZoom === 14) return 6000;
    return 9500;
  }, [mapZoom]);

  const combinedFilters = useMemo<ToiletFilters>(
    () => ({
      ...filters,
      includeInferred: effectiveIncludeInferred,
      inferredCategory,
    }),
    [filters, effectiveIncludeInferred, inferredCategory]
  );

  const {
    toilets,
    nearest,
    confirmedWithin500m,
    hasCompletedInitialScan,
    isLoading,
    isSyncingPois,
    isSyncingInferred,
    refreshAreaPois,
  } = useToilets({
    lng: queryCenter[0],
    lat: queryCenter[1],
    radius: dynamicRadius,
    bounds: viewportBounds,
    filters: combinedFilters,
  });

  // 周边 500m 内已确认公厕 < 2 个时智能自动启用「🧭 推测可借用」
  useEffect(() => {
    if (manualInferredChoice !== null) return;
    if (!hasCompletedInitialScan || confirmedWithin500m === undefined) return;

    if (confirmedWithin500m < 2) {
      if (!autoInferred) {
        setAutoInferred(true);
        if (!notifiedAutoInferredRef.current) {
          notifiedAutoInferredRef.current = true;
          toast.info(
            '附近500m已确认公厕较少，已自动开启「🧭 推测可借用」标出医院/商场/加油站等可能借厕点'
          );
        }
      }
    } else if (confirmedWithin500m >= 3 && autoInferred) {
      setAutoInferred(false);
    }
  }, [
    manualInferredChoice,
    hasCompletedInitialScan,
    confirmedWithin500m,
    autoInferred,
  ]);

  const inferredCount = useMemo(
    () => toilets.filter((t) => t.source === 'INFERRED').length,
    [toilets]
  );
  const confirmedCount = toilets.length - inferredCount;

  // 当前已开启的筛选项数量角标
  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filters.isFree) c++;
    if (filters.hasPaper) c++;
    if (filters.hasAccessible) c++;
    if (filters.onlyMine) c++;
    if (effectiveIncludeInferred && inferredCategory !== 'ALL') c++;
    return c;
  }, [filters, effectiveIncludeInferred, inferredCategory]);

  // 仅当用户主动点击选中点位时才展开完整详情卡（绝不默认强弹遮挡地图）
  const expandedToilet = useMemo(() => {
    if (!selectedToilet) return null;
    return toilets.find((t) => t.id === selectedToilet.id) || selectedToilet;
  }, [selectedToilet, toilets]);

  const closeAllPopovers = useCallback(() => {
    setSuggestions([]);
    setHotspotOpen(false);
    setFilterOpen(false);
    setInferredTipOpen(false);
  }, []);

  const handleToggleInferredCapsule = () => {
    const next = !effectiveIncludeInferred;
    setManualInferredChoice(next);
    if (!next) {
      setInferredCategory('ALL');
      setInferredTipOpen(false);
    } else {
      toast.info(
        '琥珀虚线标仅代表「可能存在卫生间」(未核实)，最终请看留言或上传实拍图自动审核确认'
      );
    }
  };

  const handleManualRefreshArea = async () => {
    const count = await refreshAreaPois();
    if (count > 0) {
      toast.success(`已从高德地图补全当前区域点位（共扫描 ${count} 个）`);
    } else {
      toast.info('当前区域点位已是最新数据');
    }
  };

  const handleSearchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    closeAllPopovers();
    const kw = searchInput.trim();
    if (!kw) {
      setFilters((f) => ({ ...f, keyword: '' }));
      return;
    }

    if (GENERIC_TOILET_QUERY_RE.test(kw)) {
      setFilters((f) => ({ ...f, keyword: '' }));
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
    closeAllPopovers();
    if (label) {
      toast.success(`已切换至：${label}`);
    }
  };

  const handleUrgentClick = () => {
    if (!nearest) {
      toast.error('当前视野暂无可用点位，可开启「🧭 推测可借用」或缩小地图重试');
      return;
    }
    closeAllPopovers();
    userMovedMapRef.current = true;
    setSelectedToilet(nearest);
    flyTo(nearest.lng, nearest.lat, Math.max(mapZoom, 16), true);
    setNavTarget(nearest);
  };

  const handleLocateMe = async () => {
    closeAllPopovers();
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

  const resetAllFilters = () => {
    setFilters({});
    setInferredCategory('ALL');
  };

  const handleOpenList = () => {
    closeAllPopovers();
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setSidebarOpen((v) => !v);
    } else {
      setDrawerOpen(true);
    }
  };

  return (
    <div className="relative flex h-[calc(100dvh-3.5rem)] w-full overflow-hidden select-none">
      {/* ==================== 电脑端按需滑出的紧凑列表栏（默认收起，不遮挡全屏地图） ==================== */}
      {sidebarOpen && (
        <aside className="hidden md:flex flex-col w-[340px] lg:w-[360px] shrink-0 h-full bg-white border-r border-slate-200 z-30 shadow-lg">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div>
              <div className="text-sm font-extrabold text-slate-900">
                附近点位列表 ({toilets.length})
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                确切公厕 <strong className="text-blue-600">{confirmedCount}</strong>
                {effectiveIncludeInferred && (
                  <>
                    {' '}
                    · 推测可能{' '}
                    <strong className="text-amber-600">{inferredCount}</strong>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
              收起
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 desktop-scrollbar">
            {isLoading && toilets.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                正在检索附近公共厕所...
              </div>
            ) : toilets.length === 0 ? (
              <div className="py-14 px-5 text-center space-y-3">
                <div className="text-3xl">🗺️</div>
                <p className="text-xs text-slate-500">
                  {isSyncingPois
                    ? '正在从高德地图扫描当前区域公厕...'
                    : '当前视野内暂无符合筛选的公厕'}
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {!effectiveIncludeInferred && (
                    <button
                      type="button"
                      onClick={handleToggleInferredCapsule}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      开启推测可借用
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleManualRefreshArea}
                    disabled={isSyncingPois}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isSyncingPois ? 'animate-spin' : ''}`}
                    />
                    刷新区域
                  </button>
                </div>
              </div>
            ) : (
              toilets.map((t) => {
                const isSelected = expandedToilet?.id === t.id;
                const isInferred = t.source === 'INFERRED';
                const inferredMeta = isInferred
                  ? getInferredCategoryMeta(t.inferredCategory)
                  : null;
                const isNearestConfirmed = nearest?.id === t.id && !isInferred;

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
                    className={`p-3 cursor-pointer transition border-l-4 ${
                      isSelected
                        ? isInferred
                          ? 'bg-amber-50/60 border-l-amber-500'
                          : 'bg-blue-50/60 border-l-blue-600'
                        : 'bg-white hover:bg-slate-50 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      {isInferred && inferredMeta ? (
                        <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded">
                          {inferredMeta.emoji} 推测·{inferredMeta.shortLabel}
                        </span>
                      ) : (
                        isNearestConfirmed && (
                          <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">
                            最近
                          </span>
                        )
                      )}
                      {t.floor && (
                        <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                          {t.floor}
                        </span>
                      )}
                      <h4 className="font-bold text-slate-900 text-sm truncate flex-1">
                        {t.name}
                      </h4>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex items-center gap-2 flex-wrap">
                        {t.distance !== undefined && (
                          <span
                            className={`font-semibold ${
                              isInferred ? 'text-amber-700' : 'text-blue-600'
                            }`}
                          >
                            {formatDistance(t.distance)} · 约
                            {estimateWalkMinutes(t.distance)}分钟
                          </span>
                        )}
                        {(t.availableVotes || 0) > 0 && (
                          <span className="text-[11px] font-semibold text-emerald-700">
                            ✅{t.availableVotes}人测
                          </span>
                        )}
                        {t.avgRating > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-amber-500 font-medium">
                            <Star className="w-3 h-3 fill-amber-400" />
                            {t.avgRating.toFixed(1)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Link
                          href={`/toilet/${t.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                          title="详情与留言"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNavTarget(t);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-white text-xs font-semibold inline-flex items-center gap-1 transition ${
                            isInferred
                              ? 'bg-amber-600 hover:bg-amber-700'
                              : 'bg-blue-600 hover:bg-blue-700'
                          }`}
                        >
                          <Navigation className="w-3 h-3" />
                          导航
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* ==================== 全屏高德地图主画布 ==================== */}
      <div className="relative flex-1 h-full overflow-hidden">
        <InteractiveMap
          center={mapCenter}
          zoom={mapZoom}
          flyVersion={flyVersion}
          userLocation={location}
          toilets={toilets}
          nearestId={nearest?.id || null}
          selectedId={expandedToilet?.id || null}
          hoveredId={hoveredToiletId}
          showZoomControls
          zoomControlPosition="bottom-left"
          onInteractStart={() => {
            if (interactTimerRef.current) {
              clearTimeout(interactTimerRef.current);
            }
            setIsInteractingMap(true);
            closeAllPopovers();
          }}
          onMapBlankClick={() => {
            closeAllPopovers();
            setSelectedToilet(null);
          }}
          onMoveEnd={(lng, lat, z, b, isUserAction) => {
            setQueryCenter([lng, lat]);
            const nextZ = typeof z === 'number' ? z : mapZoomRef.current;
            if (typeof z === 'number') setMapZoom(z);
            if (b) setViewportBounds(b);
            if (isUserAction) {
              userMovedMapRef.current = true;
              hasRealPositionRef.current = true;
              saveMapViewport(lng, lat, nextZ);
              setSelectedToilet(null);
            } else if (hasRealPositionRef.current) {
              saveMapViewport(lng, lat, nextZ);
            }
            if (interactTimerRef.current) {
              clearTimeout(interactTimerRef.current);
            }
            interactTimerRef.current = setTimeout(() => {
              setIsInteractingMap(false);
            }, 140);
          }}
          onSelectToilet={(t) => {
            closeAllPopovers();
            if (selectedToilet?.id === t.id) {
              router.push(`/toilet/${t.id}`);
            } else {
              setSelectedToilet(t);
            }
          }}
        />

        {/* ==================== 极简一体式顶部悬浮控制区（拖动地图时自动平滑退让） ==================== */}
        <div
          className={`absolute top-2.5 left-2.5 right-2.5 md:top-3.5 md:left-3.5 md:right-auto md:w-[390px] z-30 space-y-1.5 transition-all duration-200 ${
            isInteractingMap
              ? 'opacity-0 -translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 pointer-events-none'
          }`}
        >
          {/* 第 1 行：一体化胶囊搜索栏（内嵌城市快切 + 搜索输入 + 区域刷新） */}
          <div className="relative flex items-center bg-white/95 backdrop-blur-md rounded-2xl shadow-md border border-slate-200/90 h-10 px-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={() => {
                setFilterOpen(false);
                setInferredTipOpen(false);
                setHotspotOpen((v) => !v);
              }}
              title="快速切换城市商圈"
              className="h-7 px-2 rounded-xl hover:bg-slate-100 flex items-center gap-0.5 text-xs font-bold text-slate-700 shrink-0 transition"
            >
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden sm:inline text-[11px]">城市</span>
            </button>

            <div className="w-px h-4 bg-slate-200 mx-1" />

            <form
              onSubmit={handleSearchPlace}
              className="flex-1 flex items-center min-w-0"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 ml-1 shrink-0" />
              <input
                ref={searchInputRef}
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
                className="w-full h-8 px-2 bg-transparent text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="p-1 text-slate-400 hover:text-slate-600 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {searchInput.trim() && (
                <button
                  type="submit"
                  disabled={searchingPlace}
                  className="px-2 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-semibold shrink-0 mr-1"
                >
                  {searchingPlace ? '...' : '搜'}
                </button>
              )}
            </form>

            <button
              type="button"
              onClick={handleManualRefreshArea}
              disabled={isSyncingPois}
              title="重新扫描当前视野内的高德公厕"
              className="h-7 w-7 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 shrink-0 transition"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-blue-600 ${
                  isSyncingPois ? 'animate-spin' : ''
                }`}
              />
            </button>

            {/* 城市商圈下拉浮层 */}
            {hotspotOpen && (
              <div className="absolute top-11 left-0 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-50">
                <div className="px-3 py-1 text-[11px] font-semibold text-slate-400">
                  快速切换热门城市商圈
                </div>
                {CITY_HOTSPOTS.map((spot) => (
                  <button
                    key={spot.name}
                    type="button"
                    onClick={() => jumpToPlace(spot.lng, spot.lat, spot.name)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 active:bg-blue-50 flex items-center gap-1.5"
                  >
                    <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span className="truncate">{spot.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 搜索结果联想下拉 */}
            {suggestions.length > 0 && (
              <div className="absolute top-11 left-0 right-0 bg-white rounded-2xl shadow-xl border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto z-50">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSearchInput(s.name);
                      jumpToPlace(s.lng, s.lat, s.name);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 active:bg-blue-50 transition"
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
          </div>

          {/* 第 2 行：仅保留 3 枚精炼核心胶囊（列表 · 🧭推测可借用 · ⚡筛选） */}
          <div className="relative flex items-center gap-1.5 pointer-events-auto flex-wrap">
            <button
              type="button"
              onClick={handleOpenList}
              className={`h-8 px-3 rounded-full text-xs font-semibold shadow-sm border inline-flex items-center gap-1 transition ${
                sidebarOpen
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-900/90 hover:bg-slate-900 text-white border-slate-900/90'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>
                {sidebarOpen ? '收起列表' : '附近'}{' '}
                {isLoading && toilets.length === 0 ? '...' : toilets.length}
              </span>
            </button>

            {/* 🧭 推测可借用胶囊 + 精巧问号免责声明气泡触发器（替代占整行的大黄条） */}
            <div className="inline-flex items-center rounded-full shadow-sm overflow-hidden border border-amber-300/90 bg-white/95 backdrop-blur-md">
              <button
                type="button"
                onClick={handleToggleInferredCapsule}
                className={`h-8 px-2.5 text-xs font-bold inline-flex items-center gap-1 transition ${
                  effectiveIncludeInferred
                    ? 'bg-amber-500 text-white'
                    : 'text-amber-900 hover:bg-amber-50'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>
                  推测可借用
                  {isAutoEnabledMode ? '(自动)' : ''}
                  {effectiveIncludeInferred && inferredCount > 0
                    ? ` ${inferredCount}`
                    : ''}
                </span>
              </button>
              {effectiveIncludeInferred && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterOpen(false);
                    setHotspotOpen(false);
                    setInferredTipOpen((v) => !v);
                  }}
                  title="查看未核实风险说明"
                  aria-label="查看未核实风险说明"
                  className="h-8 px-2 bg-amber-600 hover:bg-amber-700 text-amber-50 inline-flex items-center justify-center border-l border-amber-400/50 transition"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* ⚡ 合并筛选按钮（收纳属性筛选 + 8类推测场所二级分类） */}
            <button
              type="button"
              onClick={() => {
                setHotspotOpen(false);
                setInferredTipOpen(false);
                setFilterOpen((v) => !v);
              }}
              className={`h-8 px-3 rounded-full text-xs font-semibold shadow-sm border inline-flex items-center gap-1 transition ${
                activeFilterCount > 0 || filterOpen
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white/95 backdrop-blur-md text-slate-700 border-slate-200/90 hover:bg-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>
                筛选{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
              </span>
            </button>

            {/* 同步微状态指示 */}
            {isSyncingPois && (
              <span className="h-7 px-2.5 rounded-full bg-white/90 backdrop-blur-md border border-slate-200/80 text-[11px] text-blue-600 font-medium inline-flex items-center gap-1 shadow-sm">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {isSyncingInferred ? '检索场所' : '扫描中'}
              </span>
            )}

            {/* 问号点击弹出的轻量免责说明卡片（平时不挡地图） */}
            {inferredTipOpen && (
              <div className="absolute top-10 left-0 right-0 sm:w-80 bg-amber-50 rounded-2xl shadow-xl border border-amber-300 p-3 text-xs text-amber-900 leading-relaxed z-50">
                <div className="flex items-center justify-between font-bold mb-1">
                  <span>⚠️ 推测点位未核实说明</span>
                  <button
                    type="button"
                    onClick={() => setInferredTipOpen(false)}
                    className="p-0.5 text-amber-700 hover:text-amber-950"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-amber-800">
                  琥珀色虚线标（医院、商场、超市、公园、加油站、快餐、政务馆驿、酒店大堂）仅代表<strong>可能</strong>有对外免费卫生间，受营业时间影响。最终确认请看网友留言，或现场上传实拍图通过<strong>自动审核转正</strong>。
                </p>
              </div>
            )}

            {/* ⚡ 按需展开的合并筛选面板 */}
            {filterOpen && (
              <div className="absolute top-10 left-0 right-0 sm:w-[340px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3.5 space-y-3 z-50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800">
                    筛选条件
                  </span>
                  <div className="flex items-center gap-2">
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={resetAllFilters}
                        className="text-[11px] text-blue-600 hover:underline font-medium"
                      >
                        重置全部
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFilterOpen(false)}
                      className="p-1 rounded-full text-slate-400 hover:bg-slate-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-slate-400 font-medium mb-1.5">
                    厕所属性
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleFilter('isFree')}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-medium border text-left transition ${
                        filters.isFree
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      🆓 免费使用
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFilter('hasPaper')}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-medium border text-left transition ${
                        filters.hasPaper
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      🧻 提供厕纸
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFilter('hasAccessible')}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-medium border text-left transition ${
                        filters.hasAccessible
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      ♿ 无障碍设施
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFilter('onlyMine')}
                      className={`py-1.5 px-2.5 rounded-xl text-xs font-medium border text-left transition ${
                        filters.onlyMine
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      🔒 只看我的标记
                    </button>
                  </div>
                </div>

                {effectiveIncludeInferred && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-[11px] text-amber-700 font-semibold mb-1.5">
                      🧭 推测可借用场所类型（8类）
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setInferredCategory('ALL')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                          inferredCategory === 'ALL'
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-amber-50 text-amber-900 border-amber-200'
                        }`}
                      >
                        全部8类
                      </button>
                      {INFERRED_CATEGORY_LIST.map((cat) => (
                        <button
                          key={cat.key}
                          type="button"
                          onClick={() => setInferredCategory(cat.key)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                            inferredCategory === cat.key
                              ? 'bg-amber-500 text-white border-amber-500 font-bold'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50'
                          }`}
                        >
                          {cat.emoji} {cat.shortLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ==================== 电脑端右上角精简操作钮（仅保留「急」+「定位」，去除重复添加按钮） ==================== */}
        <div
          className={`hidden md:flex items-center gap-2 absolute top-3.5 right-3.5 z-30 transition-all duration-200 ${
            isInteractingMap
              ? 'opacity-0 -translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0'
          }`}
        >
          <button
            type="button"
            onClick={handleUrgentClick}
            className="h-10 px-4 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-xs font-extrabold shadow-lg shadow-red-500/25 flex items-center gap-1.5 transition"
          >
            <span>🚽</span>
            <span>急！去最近厕所</span>
          </button>

          <button
            type="button"
            onClick={handleLocateMe}
            title="回到我的定位"
            className="h-10 px-3 bg-white/95 hover:bg-white backdrop-blur-md rounded-2xl shadow-md border border-slate-200/90 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition"
          >
            <Crosshair
              className={`w-4 h-4 text-blue-600 ${
                locating && !location ? 'animate-spin' : ''
              }`}
            />
            <span>定位</span>
          </button>
        </div>

        {/* ==================== 电脑端按需弹出的选中点位详情卡（未点击标记时不显示，绝不常驻挡地图） ==================== */}
        {expandedToilet && (
          <div
            className={`hidden md:block absolute bottom-5 right-5 z-30 w-[350px] transition-all duration-200 ${
              isInteractingMap
                ? 'opacity-0 translate-y-3 pointer-events-none'
                : 'opacity-100 translate-y-0'
            }`}
          >
            <NearestToiletCard
              toilet={expandedToilet}
              isNearest={
                nearest?.id === expandedToilet.id &&
                expandedToilet.source !== 'INFERRED'
              }
              onNavigate={(t) => setNavTarget(t)}
              onClose={() => setSelectedToilet(null)}
            />
          </div>
        )}

        {/* ==================== 手机端右下精简悬浮圆钮（去掉与底栏重复的 + 按钮，只留「急」与「定位」） ==================== */}
        <div
          className={`md:hidden absolute right-3 z-30 flex flex-col items-center gap-2.5 transition-all duration-200 ${
            expandedToilet ? 'bottom-52' : 'bottom-16'
          } ${
            isInteractingMap
              ? 'opacity-0 translate-x-3 pointer-events-none'
              : 'opacity-100 translate-x-0'
          }`}
        >
          <button
            type="button"
            onClick={handleUrgentClick}
            className="w-12 h-12 rounded-full bg-red-500 active:scale-95 text-white shadow-lg shadow-red-500/35 border-2 border-white flex flex-col items-center justify-center leading-none"
          >
            <span className="text-sm">🚽</span>
            <span className="text-[11px] font-extrabold mt-0.5">急</span>
          </button>

          <button
            type="button"
            onClick={handleLocateMe}
            aria-label="定位到我的位置"
            className="w-10 h-10 rounded-full bg-white/95 text-slate-700 shadow-md border border-slate-200 flex items-center justify-center active:scale-95"
          >
            <Crosshair
              className={`w-4 h-4 text-blue-600 ${
                locating && !location ? 'animate-spin' : ''
              }`}
            />
          </button>
        </div>

        {/* ==================== 手机端底部：默认 44px 超薄单行胶囊条，仅点击标记/迷你条时展开详情卡 ==================== */}
        <div
          className={`md:hidden absolute bottom-2.5 left-2.5 right-2.5 z-30 transition-all duration-200 ${
            isInteractingMap
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0'
          }`}
        >
          {expandedToilet ? (
            <NearestToiletCard
              toilet={expandedToilet}
              isNearest={
                nearest?.id === expandedToilet.id &&
                expandedToilet.source !== 'INFERRED'
              }
              onNavigate={(t) => setNavTarget(t)}
              onClose={() => setSelectedToilet(null)}
            />
          ) : nearest ? (
            <div className="h-11 bg-white/95 backdrop-blur-md rounded-full shadow-lg border border-slate-200/90 pl-3 pr-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedToilet(nearest);
                  flyTo(nearest.lng, nearest.lat, Math.max(mapZoom, 16), true);
                }}
                className="min-w-0 flex-1 flex items-center gap-1.5 text-left"
              >
                <span
                  className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white ${
                    nearest.source === 'INFERRED'
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                  }`}
                >
                  {nearest.source === 'INFERRED' ? '推测' : '最近'}
                </span>
                <span className="text-xs font-bold text-slate-800 truncate">
                  {nearest.name}
                </span>
                {nearest.distance !== undefined && (
                  <span className="shrink-0 text-[11px] font-semibold text-blue-600">
                    {formatDistance(nearest.distance)}
                  </span>
                )}
                <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setNavTarget(nearest)}
                className={`shrink-0 h-8 px-3 rounded-full text-white text-xs font-bold inline-flex items-center gap-1 shadow-sm ${
                  nearest.source === 'INFERRED'
                    ? 'bg-amber-600 active:bg-amber-700'
                    : 'bg-blue-600 active:bg-blue-700'
                }`}
              >
                <Navigation className="w-3 h-3" />
                导航
              </button>
            </div>
          ) : !isLoading && !isSyncingPois ? (
            <div className="h-11 bg-white/95 backdrop-blur-md rounded-full shadow-md border border-slate-200/90 pl-3.5 pr-1.5 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600 truncate">
                当前视野暂无公厕，可开启推测借用或刷新
              </span>
              {!effectiveIncludeInferred ? (
                <button
                  type="button"
                  onClick={handleToggleInferredCapsule}
                  className="shrink-0 h-8 px-3 rounded-full bg-amber-500 text-white text-xs font-bold"
                >
                  🧭 推测借用
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleManualRefreshArea}
                  className="shrink-0 h-8 px-3 rounded-full bg-blue-600 text-white text-xs font-bold"
                >
                  刷新
                </button>
              )}
            </div>
          ) : null}
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
