'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatDistance } from '@/lib/geo';
import type { MapEngineType, ToiletItem } from '@/types';

const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY || '';
const AMAP_SECURITY_CODE = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || '';
const TMAP_KEY = process.env.NEXT_PUBLIC_TMAP_KEY || '';

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
  engine?: MapEngineType;
  onEngineFallback?: (nextEngine: MapEngineType, reason?: string) => void;
  onMoveEnd?: (lng: number, lat: number) => void;
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
    const timer = setTimeout(() => controller.abort(), 2500);
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
  cachedAmapKeyType = 'jsapi';
  return 'jsapi';
}

function loadTencentMapScript(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if ((window as any).TMap) return Promise.resolve((window as any).TMap);

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(
      'tencent-gljs-sdk'
    ) as HTMLScriptElement | null;
    if (existing) {
      const checkTimer = setInterval(() => {
        if ((window as any).TMap) {
          clearInterval(checkTimer);
          resolve((window as any).TMap);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkTimer);
        if ((window as any).TMap) resolve((window as any).TMap);
        else reject(new Error('腾讯地图 SDK 加载超时'));
      }, 6000);
      return;
    }

    const script = document.createElement('script');
    script.id = 'tencent-gljs-sdk';
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(TMAP_KEY)}`;
    script.async = true;
    script.onload = () => {
      if ((window as any).TMap) resolve((window as any).TMap);
      else reject(new Error('TMap 未定义'));
    };
    script.onerror = () => reject(new Error('腾讯地图脚本加载失败'));
    document.head.appendChild(script);
  });
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
  isHovered: boolean
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
  engine = 'amap',
  onEngineFallback,
  onMoveEnd,
  onSelectToilet,
  onPickLocation,
}: InteractiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedEngine, setResolvedEngine] = useState<
    'amap-sdk' | 'tmap-sdk' | 'autonavi-tiles'
  >('autonavi-tiles');
  const [mapReady, setMapReady] = useState(false);

  const callbacksRef = useRef({
    onMoveEnd,
    onSelectToilet,
    onPickLocation,
    onEngineFallback,
  });
  callbacksRef.current = {
    onMoveEnd,
    onSelectToilet,
    onPickLocation,
    onEngineFallback,
  };

  const mapRef = useRef<any>(null);
  const leafletModRef = useRef<any>(null);
  const markersLayerRef = useRef<any[]>([]);
  const pickerMarkerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const suppressMoveEndRef = useRef(false);

  // 引擎自动协商
  useEffect(() => {
    let active = true;
    setMapReady(false);

    async function decide() {
      if (engine === 'leaflet') {
        if (active) setResolvedEngine('autonavi-tiles');
        return;
      }
      if (engine === 'tmap') {
        if (!TMAP_KEY) {
          if (active) setResolvedEngine('autonavi-tiles');
          return;
        }
        try {
          await loadTencentMapScript();
          if (active) setResolvedEngine('tmap-sdk');
        } catch {
          callbacksRef.current.onEngineFallback?.(
            'leaflet',
            '腾讯地图加载受限，已自动切换极速瓦片'
          );
          if (active) setResolvedEngine('autonavi-tiles');
        }
        return;
      }

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
  }, [engine]);

  // 初始化地图实例（同时开启鼠标滚轮、拖拽、触屏双指缩放）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const containerEl: HTMLDivElement = el;

    let destroyed = false;
    let instance: any = null;
    markersLayerRef.current = [];
    pickerMarkerRef.current = null;
    userMarkerRef.current = null;
    containerEl.innerHTML = '';

    async function setup() {
      if (resolvedEngine === 'amap-sdk') {
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

          instance.on('moveend', () => {
            if (suppressMoveEndRef.current) return;
            const c = instance.getCenter();
            if (c) {
              callbacksRef.current.onMoveEnd?.(
                Number(c.getLng()),
                Number(c.getLat())
              );
            }
          });

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
          return;
        } catch {
          if (!destroyed) {
            setResolvedEngine('autonavi-tiles');
          }
          return;
        }
      }

      if (resolvedEngine === 'tmap-sdk') {
        try {
          const TMap = await loadTencentMapScript();
          if (destroyed || !TMap) return;

          instance = new TMap.Map(containerEl, {
            center: new TMap.LatLng(center[1], center[0]),
            zoom,
            viewMode: '2D',
            showControl: false,
            draggable: true,
            scrollable: true,
            doubleClickZoom: true,
          });

          instance.on('panend', () => {
            if (suppressMoveEndRef.current) return;
            const c = instance.getCenter();
            if (c) {
              callbacksRef.current.onMoveEnd?.(
                Number(c.getLng()),
                Number(c.getLat())
              );
            }
          });

          if (pickerMode) {
            instance.on('click', (evt: any) => {
              if (evt?.latLng) {
                callbacksRef.current.onPickLocation?.(
                  Number(evt.latLng.getLng()),
                  Number(evt.latLng.getLat())
                );
              }
            });
          }

          mapRef.current = instance;
          setMapReady(true);
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

      L.tileLayer(
        'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        {
          subdomains: ['1', '2', '3', '4'],
          maxZoom: 19,
          minZoom: 3,
        }
      ).addTo(instance);

      instance.on('moveend', () => {
        if (suppressMoveEndRef.current) return;
        const c = instance.getCenter();
        callbacksRef.current.onMoveEnd?.(Number(c.lng), Number(c.lat));
      });

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

  // 监听容器尺寸变化（适配手机横竖屏切换、电脑端窗口缩放、桌面侧边栏收起/展开）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map) return;
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

  // 通用缩放按钮动作（兼容电脑鼠标点击与手机单手触控）
  const handleZoomDelta = useCallback(
    (delta: number) => {
      const map = mapRef.current;
      if (!map || !mapReady) return;
      try {
        if (resolvedEngine === 'amap-sdk') {
          if (delta > 0) map.zoomIn();
          else map.zoomOut();
        } else if (resolvedEngine === 'tmap-sdk') {
          const curZoom = map.getZoom?.() || 15;
          map.setZoom?.(Math.min(19, Math.max(4, curZoom + delta)));
        } else {
          if (delta > 0) map.zoomIn();
          else map.zoomOut();
        }
      } catch {
        // ignore
      }
    },
    [mapReady, resolvedEngine]
  );

  // 外部中心点变更时平滑平移
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    suppressMoveEndRef.current = true;
    try {
      if (resolvedEngine === 'amap-sdk') {
        const cur = map.getCenter();
        if (
          !cur ||
          Math.abs(cur.getLng() - center[0]) > 0.0003 ||
          Math.abs(cur.getLat() - center[1]) > 0.0003
        ) {
          map.setCenter([center[0], center[1]]);
        }
      } else if (resolvedEngine === 'tmap-sdk') {
        const TMap = (window as any).TMap;
        const cur = map.getCenter();
        if (
          TMap &&
          (!cur ||
            Math.abs(cur.getLng() - center[0]) > 0.0003 ||
            Math.abs(cur.getLat() - center[1]) > 0.0003)
        ) {
          map.setCenter(new TMap.LatLng(center[1], center[0]));
        }
      } else {
        const cur = map.getCenter();
        if (
          !cur ||
          Math.abs(cur.lng - center[0]) > 0.0003 ||
          Math.abs(cur.lat - center[1]) > 0.0003
        ) {
          map.setView([center[1], center[0]], map.getZoom(), { animate: true });
        }
      }
    } finally {
      setTimeout(() => {
        suppressMoveEndRef.current = false;
      }, 250);
    }
  }, [center, mapReady, resolvedEngine]);

  // 渲染当前用户定位蓝点
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

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
    } else if (resolvedEngine === 'tmap-sdk' && (window as any).TMap) {
      const TMap = (window as any).TMap;
      const BaseOverlay: any = TMap.DOMOverlay;
      class UserDotOverlay extends BaseOverlay {
        position: any;
        map: any;
        dom: any;
        constructor(opts: any) {
          super(opts);
        }
        onInit(opts: any) {
          this.position = opts.position;
        }
        createDOM() {
          const div = document.createElement('div');
          div.innerHTML = dotHtml;
          div.style.position = 'absolute';
          return div;
        }
        updateDOM() {
          if (!this.map) return;
          const pixel = this.map.projectToContainer(this.position);
          this.dom.style.left = `${pixel.getX() - 10}px`;
          this.dom.style.top = `${pixel.getY() - 10}px`;
        }
      }
      userMarkerRef.current = new (UserDotOverlay as any)({
        map,
        position: new TMap.LatLng(userLocation.lat, userLocation.lng),
      });
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

  // 渲染厕所标记列表（同时响应选中态与电脑侧边栏鼠标悬停态）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || pickerMode) return;

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
        const marker = new AMap.Marker({
          position: [toilet.lng, toilet.lat],
          content: buildMarkerHtml(toilet, isNearest, isSelected, isHovered),
          anchor: 'bottom-center',
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

    if (resolvedEngine === 'tmap-sdk' && (window as any).TMap) {
      const TMap = (window as any).TMap;
      const BaseOverlay: any = TMap.DOMOverlay;
      class HtmlToiletOverlay extends BaseOverlay {
        position: any;
        html: any;
        onClick: any;
        zIndex: any;
        map: any;
        dom: any;
        constructor(opts: any) {
          super(opts);
        }
        onInit(opts: any) {
          this.position = opts.position;
          this.html = opts.html;
          this.onClick = opts.onClick;
          this.zIndex = opts.zIndex;
        }
        createDOM() {
          const div = document.createElement('div');
          div.innerHTML = this.html;
          div.style.position = 'absolute';
          div.style.transform = 'translate(-50%, -100%)';
          div.style.zIndex = String(this.zIndex || 100);
          div.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onClick?.();
          });
          return div;
        }
        updateDOM() {
          if (!this.map) return;
          const pixel = this.map.projectToContainer(this.position);
          this.dom.style.left = `${pixel.getX()}px`;
          this.dom.style.top = `${pixel.getY()}px`;
        }
      }

      markersLayerRef.current = toilets.map((toilet) => {
        const isNearest = nearestId === toilet.id;
        const isSelected = selectedId === toilet.id;
        const isHovered = hoveredId === toilet.id;
        return new (HtmlToiletOverlay as any)({
          map,
          position: new TMap.LatLng(toilet.lat, toilet.lng),
          html: buildMarkerHtml(toilet, isNearest, isSelected, isHovered),
          zIndex: isSelected || isHovered ? 240 : isNearest ? 200 : 120,
          onClick: () => callbacksRef.current.onSelectToilet?.(toilet),
        });
      });
      return;
    }

    if (leafletModRef.current) {
      const L = leafletModRef.current;
      markersLayerRef.current = toilets.map((toilet) => {
        const isNearest = nearestId === toilet.id;
        const isSelected = selectedId === toilet.id;
        const isHovered = hoveredId === toilet.id;
        const icon = L.divIcon({
          html: buildMarkerHtml(toilet, isNearest, isSelected, isHovered),
          className: 'zzcs-clean-marker',
          iconSize: [96, 42],
          iconAnchor: [48, 40],
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
  ]);

  // 选点大头针
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !pickerMode || !pickedPoint) return;

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
    } else if (resolvedEngine === 'tmap-sdk' && (window as any).TMap) {
      const TMap = (window as any).TMap;
      const BaseOverlay: any = TMap.DOMOverlay;
      class PinOverlay extends BaseOverlay {
        position: any;
        map: any;
        dom: any;
        constructor(opts: any) {
          super(opts);
        }
        onInit(opts: any) {
          this.position = opts.position;
        }
        createDOM() {
          const div = document.createElement('div');
          div.innerHTML = pinHtml;
          div.style.position = 'absolute';
          div.style.transform = 'translate(-50%, -100%)';
          div.style.pointerEvents = 'none';
          return div;
        }
        updateDOM() {
          if (!this.map) return;
          const pixel = this.map.projectToContainer(this.position);
          this.dom.style.left = `${pixel.getX()}px`;
          this.dom.style.top = `${pixel.getY()}px`;
        }
      }
      pickerMarkerRef.current = new (PinOverlay as any)({
        map,
        position: new TMap.LatLng(pickedPoint[1], pickedPoint[0]),
      });
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

      {/* 统一地图缩放控件（适配电脑无滚轮触控板与大屏鼠标点击） */}
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
            正在加载地图图层...
          </div>
        </div>
      )}
    </div>
  );
}
