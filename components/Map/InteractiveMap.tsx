'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatDistance } from '@/lib/geo';
import type { MapBounds, ToiletItem } from '@/types';

const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY || '';
const AMAP_SECURITY_CODE = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || '';

interface InteractiveMapProps {
  center: [number, number]; // [lng, lat]
  zoom?: number;
  userLocation?: { lng: number; lat: number } | null;
  toilets?: ToiletItem[];
  nearestId?: string | null;
  selectedId?: string | null;
  hoveredId?: string | null;
  pickerMode?: boolean;
  pickedPoint?: [number, number] | null;
  showZoomControls?: boolean;
  zoomControlPosition?: 'top-left' | 'bottom-left' | 'bottom-right';
  onMoveEnd?: (
    lng: number,
    lat: number,
    currentZoom?: number,
    bounds?: MapBounds | null
  ) => void;
  onSelectToilet?: (toilet: ToiletItem) => void;
  onPickLocation?: (lng: number, lat: number) => void;
}

let cachedAmapKeyType: 'unknown' | 'jsapi' | 'webservice' = 'unknown';

async function detectAmapKeyMode(): Promise<'jsapi' | 'webservice'> {
  if (cachedAmapKeyType !== 'unknown') return cachedAmapKeyType;
  if (!AMAP_KEY) {
    cachedAmapKeyType = 'webservice';
    return 'webservice';
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const res = await fetch(
      `https://restapi.amap.com/v3/ip?key=${encodeURIComponent(AMAP_KEY)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const data = await res.json();
    if (data?.status === '1') {
      cachedAmapKeyType = 'webservice';
      return 'webservice';
    }
    if (data?.infocode === '10009') {
      cachedAmapKeyType = 'jsapi';
      return 'jsapi';
    }
  } catch {
    // ignore
  }
  cachedAmapKeyType = 'webservice';
  return 'webservice';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMarkerHtml(
  toilet: ToiletItem,
  isNearest: boolean,
  isSelected: boolean,
  isHovered: boolean,
  currentZoom: number
): string {
  const distText =
    toilet.distance !== undefined ? formatDistance(toilet.distance) : '';
  const safeTitle = escapeHtml(
    `${toilet.name}${distText ? ` (${distText})` : ''}`
  );

  let bgColor = '#2563eb';
  let emoji = '🚾';
  let badge = '';

  if (toilet.status === 'PRIVATE') {
    bgColor = '#7c3aed';
    emoji = '🔒';
    badge = '私有';
  } else if (toilet.status === 'PENDING') {
    bgColor = '#d97706';
    emoji = '⏳';
    badge = '待审';
  } else if (toilet.source === 'AMAP') {
    bgColor = '#0d9488';
    emoji = '🚻';
  }

  if (isNearest) {
    bgColor = '#ef4444';
    emoji = '🚽';
    badge = '最近';
  }

  const active = isSelected || isHovered;

  // 地图缩小时（zoom <= 14）对普通点位采用紧凑圆点样式，既能清晰展示上百个公厕又不互相遮挡
  if (currentZoom <= 14 && !isNearest && !active) {
    return `
      <div title="${safeTitle}" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${bgColor};color:#fff;border:2px solid #fff;box-shadow:0 3px 10px rgba(15,23,42,0.22);font-size:13px;cursor:pointer;user-select:none;">
        <span>${emoji}</span>
      </div>
    `;
  }

  const scaleStyle = active
    ? 'transform: scale(1.16); z-index: 999;'
    : 'transform: scale(1);';
  const ringStyle = active
    ? '0 0 0 4px rgba(37, 99, 235, 0.35), 0 8px 20px rgba(15, 23, 42, 0.28)'
    : isNearest
      ? '0 0 0 5px rgba(239, 68, 68, 0.28), 0 6px 16px rgba(239, 68, 68, 0.35)'
      : '0 4px 12px rgba(15, 23, 42, 0.22)';

  return `
    <div title="${safeTitle}" style="display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;transition:transform 0.16s ease;${scaleStyle}">
      <div style="display:flex;align-items:center;gap:4px;background:${bgColor};color:#fff;padding:${
        isNearest || active ? '5px 10px' : '4px 8px'
      };border-radius:9999px;border:2px solid #fff;box-shadow:${ringStyle};font-size:12px;font-weight:700;white-space:nowrap;">
        <span style="font-size:${isNearest ? '15px' : '13px'};line-height:1;">${emoji}</span>
        ${badge ? `<span>${badge}</span>` : ''}
        ${distText ? `<span style="opacity:0.95;font-weight:600;">${distText}</span>` : ''}
      </div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${bgColor};margin-top:-1px;"></div>
    </div>
  `;
}

function readMapViewport(
  map: any,
  engine: 'amap-sdk' | 'autonavi-tiles'
): { lng: number; lat: number; zoom: number; bounds: MapBounds | null } | null {
  try {
    if (engine === 'amap-sdk') {
      const c = map.getCenter?.();
      if (!c) return null;
      const z = Math.round(Number(map.getZoom?.() || 15));
      let bounds: MapBounds | null = null;
      const b = map.getBounds?.();
      const sw = b?.getSouthWest?.();
      const ne = b?.getNorthEast?.();
      if (sw && ne) {
        bounds = {
          minLng: Number(sw.getLng()),
          minLat: Number(sw.getLat()),
          maxLng: Number(ne.getLng()),
          maxLat: Number(ne.getLat()),
        };
      }
      return { lng: Number(c.getLng()), lat: Number(c.getLat()), zoom: z, bounds };
    }

    const c = map.getCenter?.();
    if (!c) return null;
    const z = Math.round(Number(map.getZoom?.() || 15));
    let bounds: MapBounds | null = null;
    const b = map.getBounds?.();
    if (b) {
      bounds = {
        minLng: Number(b.getWest()),
        minLat: Number(b.getSouth()),
        maxLng: Number(b.getEast()),
        maxLat: Number(b.getNorth()),
      };
    }
    return { lng: Number(c.lng), lat: Number(c.lat), zoom: z, bounds };
  } catch {
    return null;
  }
}

export default function InteractiveMap({
  center,
  zoom = 15,
  userLocation,
  toilets = [],
  nearestId,
  selectedId,
  hoveredId,
  pickerMode = false,
  pickedPoint,
  showZoomControls = true,
  zoomControlPosition = 'bottom-left',
  onMoveEnd,
  onSelectToilet,
  onPickLocation,
}: InteractiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedEngine, setResolvedEngine] = useState<
    'amap-sdk' | 'autonavi-tiles' | null
  >(null);
  const [mapReady, setMapReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(zoom);

  const callbacksRef = useRef({
    onMoveEnd,
    onSelectToilet,
    onPickLocation,
  });
  callbacksRef.current = {
    onMoveEnd,
    onSelectToilet,
    onPickLocation,
  };

  const mapRef = useRef<any>(null);
  const leafletModRef = useRef<any>(null);
  const markersLayerRef = useRef<any[]>([]);
  const pickerMarkerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const suppressMoveEndRef = useRef(false);

  // 自动识别高德 Key 类型（JS API SDK 或 高德官方矢量瓦片引擎）
  useEffect(() => {
    let active = true;
    setMapReady(false);

    async function decide() {
      const mode = await detectAmapKeyMode();
      if (!active) return;
      if (mode === 'jsapi' && AMAP_KEY) {
        setResolvedEngine('amap-sdk');
      } else {
        setResolvedEngine('autonavi-tiles');
      }
    }

    decide();
    return () => {
      active = false;
    };
  }, []);

  // 初始化高德地图实例
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !resolvedEngine) return;
    const containerEl: HTMLDivElement = el;
    const activeEngine = resolvedEngine;

    let destroyed = false;
    let instance: any = null;
    markersLayerRef.current = [];
    pickerMarkerRef.current = null;
    userMarkerRef.current = null;
    containerEl.innerHTML = '';

    const emitViewport = (force = false) => {
      if (!instance || (!force && suppressMoveEndRef.current)) return;
      const vp = readMapViewport(instance, activeEngine);
      if (vp) {
        setCurrentZoom(vp.zoom);
        callbacksRef.current.onMoveEnd?.(vp.lng, vp.lat, vp.zoom, vp.bounds);
      }
    };

    async function setup() {
      if (activeEngine === 'amap-sdk') {
        try {
          if (AMAP_SECURITY_CODE) {
            (window as any)._AMapSecurityConfig = {
              securityJsCode: AMAP_SECURITY_CODE,
            };
          }
          const AMapLoaderMod = await import('@amap/amap-jsapi-loader');
          const AMapLoader = AMapLoaderMod.default || AMapLoaderMod;
          const AMap = await AMapLoader.load({
            key: AMAP_KEY,
            version: '2.0',
            plugins: ['AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.Scale'],
          });
          if (destroyed) return;

          instance = new AMap.Map(containerEl, {
            zoom,
            center: [center[0], center[1]],
            viewMode: '2D',
            dragEnable: true,
            zoomEnable: true,
            doubleClickZoom: true,
            scrollWheel: true,
            touchZoom: true,
          });

          instance.on('moveend', () => emitViewport(false));
          instance.on('zoomend', () => emitViewport(false));

          if (pickerMode) {
            instance.on('click', (e: any) => {
              if (e?.lnglat) {
                callbacksRef.current.onPickLocation?.(
                  Number(e.lnglat.getLng()),
                  Number(e.lnglat.getLat())
                );
              }
            });
          }

          mapRef.current = instance;
          setMapReady(true);
          setTimeout(() => emitViewport(true), 80);
          return;
        } catch {
          if (!destroyed) {
            setResolvedEngine('autonavi-tiles');
          }
          return;
        }
      }

      const L = (await import('leaflet')).default;
      if (destroyed) return;
      leafletModRef.current = L;

      instance = L.map(containerEl, {
        center: [center[1], center[0]],
        zoom,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        dragging: true,
      });

      // 高德官方标准中文矢量道路切片（含地铁口、商场、公园与街巷地标）
      L.tileLayer(
        'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        {
          subdomains: ['1', '2', '3', '4'],
          maxZoom: 19,
          minZoom: 3,
        }
      ).addTo(instance);

      instance.on('moveend', () => emitViewport(false));
      instance.on('zoomend', () => emitViewport(false));

      if (pickerMode) {
        instance.on('click', (e: any) => {
          if (e?.latlng) {
            callbacksRef.current.onPickLocation?.(
              Number(e.latlng.lng),
              Number(e.latlng.lat)
            );
          }
        });
      }

      mapRef.current = instance;
      setMapReady(true);
      setTimeout(() => emitViewport(true), 80);
    }

    setup();

    return () => {
      destroyed = true;
      setMapReady(false);
      try {
        if (instance?.destroy) instance.destroy();
        else if (instance?.remove) instance.remove();
      } catch {
        // ignore
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedEngine, pickerMode]);

  // 监听容器尺寸变化（适配手机横竖屏、电脑窗口缩放、侧边栏折叠展开）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map || !resolvedEngine) return;
      try {
        if (resolvedEngine === 'amap-sdk' && map.resize) {
          map.resize();
        } else if (resolvedEngine === 'autonavi-tiles' && map.invalidateSize) {
          map.invalidateSize({ animate: false });
        }
      } catch {
        // ignore
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [resolvedEngine, mapReady]);

  const handleZoomDelta = useCallback(
    (delta: number) => {
      const map = mapRef.current;
      if (!map || !mapReady) return;
      try {
        if (delta > 0) map.zoomIn();
        else map.zoomOut();
      } catch {
        // ignore
      }
    },
    [mapReady]
  );

  // 外部中心点变更时平滑平移，并在平移后上报新视野范围以触发公厕补全
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !resolvedEngine) return;

    suppressMoveEndRef.current = true;
    let moved = false;
    try {
      if (resolvedEngine === 'amap-sdk') {
        const cur = map.getCenter();
        if (
          !cur ||
          Math.abs(cur.getLng() - center[0]) > 0.0003 ||
          Math.abs(cur.getLat() - center[1]) > 0.0003
        ) {
          map.setCenter([center[0], center[1]]);
          moved = true;
        }
      } else {
        const cur = map.getCenter();
        if (
          !cur ||
          Math.abs(cur.lng - center[0]) > 0.0003 ||
          Math.abs(cur.lat - center[1]) > 0.0003
        ) {
          map.setView([center[1], center[0]], map.getZoom(), { animate: true });
          moved = true;
        }
      }
    } finally {
      setTimeout(() => {
        suppressMoveEndRef.current = false;
        if (moved && mapRef.current && resolvedEngine) {
          const vp = readMapViewport(mapRef.current, resolvedEngine);
          if (vp) {
            setCurrentZoom(vp.zoom);
            callbacksRef.current.onMoveEnd?.(
              vp.lng,
              vp.lat,
              vp.zoom,
              vp.bounds
            );
          }
        }
      }, 300);
    }
  }, [center, mapReady, resolvedEngine]);

  // 渲染当前用户定位蓝点
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !resolvedEngine) return;

    if (userMarkerRef.current) {
      try {
        if (userMarkerRef.current.setMap) userMarkerRef.current.setMap(null);
        else if (userMarkerRef.current.remove) userMarkerRef.current.remove();
      } catch {
        // ignore
      }
      userMarkerRef.current = null;
    }

    if (!userLocation) return;

    const dotHtml = `
      <div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(37,99,235,0.28);animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <div style="width:13px;height:13px;border-radius:9999px;background:#2563eb;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(37,99,235,0.5);"></div>
      </div>
    `;

    if (resolvedEngine === 'amap-sdk' && (window as any).AMap) {
      const AMap = (window as any).AMap;
      const m = new AMap.Marker({
        position: [userLocation.lng, userLocation.lat],
        content: dotHtml,
        anchor: 'center',
        zIndex: 110,
      });
      map.add(m);
      userMarkerRef.current = m;
    } else if (leafletModRef.current) {
      const L = leafletModRef.current;
      const icon = L.divIcon({
        html: dotHtml,
        className: 'zzcs-clean-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon,
        zIndexOffset: 200,
      }).addTo(map);
    }
  }, [userLocation, mapReady, resolvedEngine]);

  // 渲染高德与用户共建公厕标记
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || pickerMode || !resolvedEngine) return;

    markersLayerRef.current.forEach((m) => {
      try {
        if (m.setMap) m.setMap(null);
        else if (m.remove) m.remove();
      } catch {
        // ignore
      }
    });
    markersLayerRef.current = [];

    if (!toilets.length) return;

    if (resolvedEngine === 'amap-sdk' && (window as any).AMap) {
      const AMap = (window as any).AMap;
      const created = toilets.map((toilet) => {
        const isNearest = nearestId === toilet.id;
        const isSelected = selectedId === toilet.id;
        const isHovered = hoveredId === toilet.id;
        const compact = currentZoom <= 14 && !isNearest && !isSelected && !isHovered;
        const marker = new AMap.Marker({
          position: [toilet.lng, toilet.lat],
          content: buildMarkerHtml(
            toilet,
            isNearest,
            isSelected,
            isHovered,
            currentZoom
          ),
          anchor: compact ? 'center' : 'bottom-center',
          zIndex: isSelected || isHovered ? 240 : isNearest ? 200 : 120,
        });
        marker.on('click', () => {
          callbacksRef.current.onSelectToilet?.(toilet);
        });
        return marker;
      });
      map.add(created);
      markersLayerRef.current = created;
      return;
    }

    if (leafletModRef.current) {
      const L = leafletModRef.current;
      markersLayerRef.current = toilets.map((toilet) => {
        const isNearest = nearestId === toilet.id;
        const isSelected = selectedId === toilet.id;
        const isHovered = hoveredId === toilet.id;
        const compact = currentZoom <= 14 && !isNearest && !isSelected && !isHovered;
        const icon = L.divIcon({
          html: buildMarkerHtml(
            toilet,
            isNearest,
            isSelected,
            isHovered,
            currentZoom
          ),
          className: 'zzcs-clean-marker',
          iconSize: compact ? [28, 28] : [96, 42],
          iconAnchor: compact ? [14, 14] : [48, 40],
        });
        const m = L.marker([toilet.lat, toilet.lng], {
          icon,
          zIndexOffset: isSelected || isHovered ? 900 : isNearest ? 600 : 100,
        }).addTo(map);
        m.on('click', () => {
          callbacksRef.current.onSelectToilet?.(toilet);
        });
        return m;
      });
    }
  }, [
    toilets,
    nearestId,
    selectedId,
    hoveredId,
    pickerMode,
    mapReady,
    resolvedEngine,
    currentZoom,
  ]);

  // 选点大头针
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !pickerMode || !pickedPoint || !resolvedEngine) {
      return;
    }

    if (pickerMarkerRef.current) {
      try {
        if (pickerMarkerRef.current.setMap) pickerMarkerRef.current.setMap(null);
        else if (pickerMarkerRef.current.remove) pickerMarkerRef.current.remove();
      } catch {
        // ignore
      }
      pickerMarkerRef.current = null;
    }

    const pinHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;cursor:grab;">
        <div style="background:#ef4444;color:#fff;padding:6px 12px;border-radius:9999px;border:2.5px solid #fff;box-shadow:0 6px 16px rgba(239,68,68,0.4);font-size:13px;font-weight:700;white-space:nowrap;">
          📍 新厕所位置
        </div>
        <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid #ef4444;margin-top:-1px;"></div>
      </div>
    `;

    if (resolvedEngine === 'amap-sdk' && (window as any).AMap) {
      const AMap = (window as any).AMap;
      const m = new AMap.Marker({
        position: [pickedPoint[0], pickedPoint[1]],
        content: pinHtml,
        draggable: true,
        anchor: 'bottom-center',
      });
      m.on('dragend', (e: any) => {
        if (e?.lnglat) {
          callbacksRef.current.onPickLocation?.(
            Number(e.lnglat.getLng()),
            Number(e.lnglat.getLat())
          );
        }
      });
      map.add(m);
      pickerMarkerRef.current = m;
    } else if (leafletModRef.current) {
      const L = leafletModRef.current;
      const icon = L.divIcon({
        html: pinHtml,
        className: 'zzcs-clean-marker',
        iconSize: [120, 46],
        iconAnchor: [60, 44],
      });
      const m = L.marker([pickedPoint[1], pickedPoint[0]], {
        icon,
        draggable: true,
      }).addTo(map);
      m.on('dragend', () => {
        const pos = m.getLatLng();
        callbacksRef.current.onPickLocation?.(Number(pos.lng), Number(pos.lat));
      });
      pickerMarkerRef.current = m;
    }
  }, [pickedPoint, pickerMode, mapReady, resolvedEngine]);

  const zoomPosClass =
    zoomControlPosition === 'top-left'
      ? 'top-3 left-3'
      : zoomControlPosition === 'bottom-right'
        ? 'bottom-3 right-3'
        : 'hidden md:flex bottom-5 left-5';

  return (
    <div className="relative w-full h-full bg-slate-100 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {showZoomControls && mapReady && (
        <div
          className={`absolute z-20 flex flex-col bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200/90 overflow-hidden ${zoomPosClass}`}
        >
          <button
            type="button"
            onClick={() => handleZoomDelta(1)}
            title="放大地图"
            aria-label="放大地图"
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 border-b border-slate-100 transition"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoomDelta(-1)}
            title="缩小地图"
            aria-label="缩小地图"
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      )}

      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 z-10">
          <div className="flex items-center gap-2 text-sm text-slate-500 bg-white px-4 py-2 rounded-full shadow-sm">
            <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            正在加载高德地图图层...
          </div>
        </div>
      )}
    </div>
  );
}
