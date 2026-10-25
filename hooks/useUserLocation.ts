'use client';

import { useCallback, useEffect, useState } from 'react';
import { isInGreaterChina, wgs84ToGcj02 } from '@/lib/geo';
import { locateByAmapIpClient } from '@/lib/mapService';

export type LocationAccuracyLevel = 'gps' | 'network' | 'ip';

export interface UserCoords {
  lng: number;
  lat: number;
  inChina: boolean;
  accuracy: LocationAccuracyLevel;
  city?: string;
  updatedAt: number;
}

export interface SavedMapViewport {
  lng: number;
  lat: number;
  zoom: number;
  source: 'session' | 'user' | 'history';
}

const USER_LOC_STORAGE_KEY = 'zzcs_user_location_v1';
const SESSION_VIEWPORT_KEY = 'zzcs_session_viewport_v1';
const LAST_VIEWPORT_KEY = 'zzcs_last_viewport_v1';

const ACCURACY_RANK: Record<LocationAccuracyLevel, number> = {
  ip: 1,
  network: 2,
  gps: 3,
};

// ==================== 模块级全局共享定位状态（跨页面路由切换不丢失、不重复重置） ====================
let sharedLocation: UserCoords | null = null;
let sharedLoading = true;
let sharedError: string | null = null;
let bootStarted = false;
let watchId: number | null = null;
let hydratedFromStorage = false;

const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

export function readCachedUserLocation(): UserCoords | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_LOC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lng = Number(parsed?.lng);
    const lat = Number(parsed?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const accuracy: LocationAccuracyLevel =
      parsed?.accuracy === 'gps' ||
      parsed?.accuracy === 'network' ||
      parsed?.accuracy === 'ip'
        ? parsed.accuracy
        : 'gps';
    return {
      lng,
      lat,
      inChina: Boolean(parsed?.inChina ?? isInGreaterChina(lng, lat)),
      accuracy,
      city: typeof parsed?.city === 'string' ? parsed.city : undefined,
      updatedAt: Number(parsed?.updatedAt || Date.now()),
    };
  } catch {
    return null;
  }
}

function persistUserLocation(loc: UserCoords) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(USER_LOC_STORAGE_KEY, JSON.stringify(loc));
  } catch {
    // ignore storage quota errors
  }
}

export function saveMapViewport(lng: number, lat: number, zoom = 15) {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  const payload = JSON.stringify({
    lng: Number(lng.toFixed(6)),
    lat: Number(lat.toFixed(6)),
    zoom: Math.round(zoom),
    updatedAt: Date.now(),
  });
  try {
    window.sessionStorage.setItem(SESSION_VIEWPORT_KEY, payload);
    window.localStorage.setItem(LAST_VIEWPORT_KEY, payload);
  } catch {
    // ignore
  }
}

export function readPreferredInitialView(): SavedMapViewport | null {
  if (typeof window === 'undefined') return null;

  // 1. 当前标签页会话内刚浏览过的视野（从详情页/添加页/个人中心返回地图时 100% 保持原位）
  try {
    const sessRaw = window.sessionStorage.getItem(SESSION_VIEWPORT_KEY);
    if (sessRaw) {
      const s = JSON.parse(sessRaw);
      if (Number.isFinite(Number(s?.lng)) && Number.isFinite(Number(s?.lat))) {
        return {
          lng: Number(s.lng),
          lat: Number(s.lat),
          zoom: Number(s.zoom) || 15,
          source: 'session',
        };
      }
    }
  } catch {
    // ignore
  }

  // 2. 已缓存的用户真实定位（重新打开网页时直接落在用户所在位置，不回跳北京）
  const cachedLoc = sharedLocation || readCachedUserLocation();
  if (cachedLoc) {
    return {
      lng: cachedLoc.lng,
      lat: cachedLoc.lat,
      zoom: cachedLoc.accuracy === 'ip' ? 14 : 16,
      source: 'user',
    };
  }

  // 3. 历史最后浏览视野兜底
  try {
    const lastRaw = window.localStorage.getItem(LAST_VIEWPORT_KEY);
    if (lastRaw) {
      const l = JSON.parse(lastRaw);
      if (Number.isFinite(Number(l?.lng)) && Number.isFinite(Number(l?.lat))) {
        return {
          lng: Number(l.lng),
          lat: Number(l.lat),
          zoom: Number(l.zoom) || 15,
          source: 'history',
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function hydrateOnce() {
  if (hydratedFromStorage || typeof window === 'undefined') return;
  hydratedFromStorage = true;
  const cached = readCachedUserLocation();
  if (cached) {
    sharedLocation = cached;
  }
}

function applyLocationCandidate(candidate: UserCoords, allowDowngrade = false) {
  if (sharedLocation && !allowDowngrade) {
    const curRank = ACCURACY_RANK[sharedLocation.accuracy] || 1;
    const nextRank = ACCURACY_RANK[candidate.accuracy] || 1;
    const isCurrentFresh = Date.now() - sharedLocation.updatedAt < 30 * 60 * 1000;
    // 绝不用粗略 IP 定位覆盖已有的精准 GPS / Wi-Fi 定位
    if (nextRank < curRank && isCurrentFresh) {
      return;
    }
  }

  sharedLocation = candidate;
  sharedError = null;
  sharedLoading = false;
  persistUserLocation(candidate);
  notifySubscribers();
}

function getBrowserPositionOnce(
  options: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function startPassiveGpsWatch() {
  if (
    typeof window === 'undefined' ||
    !navigator.geolocation ||
    watchId !== null
  ) {
    return;
  }
  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const rawLng = pos.coords.longitude;
        const rawLat = pos.coords.latitude;
        const inChina = isInGreaterChina(rawLng, rawLat);
        const converted = wgs84ToGcj02(rawLng, rawLat);
        const acc: LocationAccuracyLevel =
          pos.coords.accuracy && pos.coords.accuracy <= 150 ? 'gps' : 'network';
        applyLocationCandidate({
          lng: converted.lng,
          lat: converted.lat,
          inChina,
          accuracy: acc,
          updatedAt: Date.now(),
        });
      },
      () => {
        // 信号短暂波动时保持已有定位，绝不清空导致地图回跳
      },
      {
        enableHighAccuracy: true,
        maximumAge: 20000,
        timeout: 12000,
      }
    );
  } catch {
    // ignore
  }
}

async function performFullLocationFlow(force = false): Promise<UserCoords | null> {
  if (typeof window === 'undefined') return null;
  hydrateOnce();

  sharedLoading = true;
  notifySubscribers();

  // 第 0 层：若尚无精准定位缓存（或电脑端浏览器定位慢），并发跑高德 IP 城市定位快速托底，避免落回北京
  const ipFallbackTask = (async () => {
    if (
      !force &&
      sharedLocation &&
      ACCURACY_RANK[sharedLocation.accuracy] >= 2
    ) {
      return null;
    }
    const ipRes = await locateByAmapIpClient();
    if (ipRes) {
      const candidate: UserCoords = {
        lng: ipRes.lng,
        lat: ipRes.lat,
        inChina: isInGreaterChina(ipRes.lng, ipRes.lat),
        accuracy: 'ip',
        city: ipRes.city,
        updatedAt: Date.now(),
      };
      applyLocationCandidate(candidate, false);
      return candidate;
    }
    return null;
  })();

  // 第 1 层：高精度硬件 GPS 定位（4.5 秒快速超时）
  if (navigator.geolocation) {
    try {
      const pos = await getBrowserPositionOnce({
        enableHighAccuracy: true,
        timeout: 4500,
        maximumAge: force ? 0 : 60000,
      });
      const rawLng = pos.coords.longitude;
      const rawLat = pos.coords.latitude;
      const converted = wgs84ToGcj02(rawLng, rawLat);
      const gpsLoc: UserCoords = {
        lng: converted.lng,
        lat: converted.lat,
        inChina: isInGreaterChina(rawLng, rawLat),
        accuracy: 'gps',
        updatedAt: Date.now(),
      };
      applyLocationCandidate(gpsLoc, true);
      startPassiveGpsWatch();
      return gpsLoc;
    } catch (err: any) {
      // 第 2 层：若室内 GPS 超时或不可用（非用户拒绝权限），自动降级为 Wi-Fi/基站网络定位
      if (err?.code !== 1) {
        try {
          const netPos = await getBrowserPositionOnce({
            enableHighAccuracy: false,
            timeout: 6000,
            maximumAge: force ? 15000 : 180000,
          });
          const rawLng = netPos.coords.longitude;
          const rawLat = netPos.coords.latitude;
          const converted = wgs84ToGcj02(rawLng, rawLat);
          const netLoc: UserCoords = {
            lng: converted.lng,
            lat: converted.lat,
            inChina: isInGreaterChina(rawLng, rawLat),
            accuracy: 'network',
            updatedAt: Date.now(),
          };
          applyLocationCandidate(netLoc, true);
          startPassiveGpsWatch();
          return netLoc;
        } catch (netErr: any) {
          sharedError = netErr?.message || '浏览器精确定位暂不可用';
        }
      } else {
        sharedError = '浏览器定位权限未开启，已使用网络城市定位';
      }
    }
  } else {
    sharedError = '当前浏览器不支持 GPS 定位';
  }

  // 等待 IP 兜底定位结果
  const ipLoc = await ipFallbackTask;
  sharedLoading = false;
  notifySubscribers();
  return sharedLocation || ipLoc;
}

export function useUserLocation() {
  hydrateOnce();
  const [, setTick] = useState(0);

  useEffect(() => {
    hydrateOnce();
    const rerender = () => setTick((t) => t + 1);
    subscribers.add(rerender);

    if (!bootStarted) {
      bootStarted = true;
      void performFullLocationFlow(false);
    } else {
      rerender();
    }

    return () => {
      subscribers.delete(rerender);
    };
  }, []);

  const requestLocation = useCallback((force = true) => {
    return performFullLocationFlow(force);
  }, []);

  return {
    location: sharedLocation,
    loading: sharedLoading,
    error: sharedError,
    requestLocation,
  };
}
