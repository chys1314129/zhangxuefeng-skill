// lib/mapService.ts
// 纯后端代理高德地图客户端服务层：
// - 前端 0 Key 暴露（绝不在浏览器端携带或请求任何高德 API Key，彻底防盗刷）
// - 周边公厕与推测场所直接走服务端「全站共享 SQLite 区域冷却缓存」同步入库
// - 逆地理编码、地点搜索、IP 兜底定位全部走服务端缓存网关

import type { MapBounds } from '@/types';

export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
}

export interface AreaSyncResponse {
  cached: boolean;
  cooldownRemainingSec: number;
  poiCount: number;
  synced: number;
  updated: number;
  retired: number;
  syncedInferred: number;
}

/**
 * 触发服务端共享街区公厕同步（命中 24h 全站共享冷却缓存时 0 高德配额消耗，毫秒级返回）
 */
export async function syncNearbyToiletsSharedClient(opts: {
  lng: number;
  lat: number;
  radius?: number;
  bounds?: MapBounds | null;
  force?: boolean;
  authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<AreaSyncResponse> {
  const empty: AreaSyncResponse = {
    cached: true,
    cooldownRemainingSec: 0,
    poiCount: 0,
    synced: 0,
    updated: 0,
    retired: 0,
    syncedInferred: 0,
  };
  if (typeof window === 'undefined') return empty;

  const clampedRadius = Math.min(Math.max(opts.radius || 3000, 1500), 8000);
  const qs = new URLSearchParams({
    lng: opts.lng.toFixed(6),
    lat: opts.lat.toFixed(6),
    radius: String(clampedRadius),
  });
  if (opts.bounds) {
    qs.set('minLng', opts.bounds.minLng.toFixed(6));
    qs.set('minLat', opts.bounds.minLat.toFixed(6));
    qs.set('maxLng', opts.bounds.maxLng.toFixed(6));
    qs.set('maxLat', opts.bounds.maxLat.toFixed(6));
  }
  if (opts.force) {
    qs.set('force', 'true');
  }

  try {
    const fetcher = opts.authFetch || fetch;
    const res = await fetcher(`/api/v1/amap/around?${qs.toString()}`);
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        return json.data as AreaSyncResponse;
      }
    }
  } catch {
    // ignore
  }
  return empty;
}

/**
 * 触发服务端共享街区「8大类推测可借用场所」同步（命中 24h 全站共享冷却缓存时 0 高德配额消耗）
 */
export async function syncInferredVenuesSharedClient(opts: {
  lng: number;
  lat: number;
  radius?: number;
  force?: boolean;
  authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<AreaSyncResponse> {
  const empty: AreaSyncResponse = {
    cached: true,
    cooldownRemainingSec: 0,
    poiCount: 0,
    synced: 0,
    updated: 0,
    retired: 0,
    syncedInferred: 0,
  };
  if (typeof window === 'undefined') return empty;

  const clampedRadius = Math.min(Math.max(opts.radius || 2500, 1500), 5000);
  const qs = new URLSearchParams({
    mode: 'inferred',
    lng: opts.lng.toFixed(6),
    lat: opts.lat.toFixed(6),
    radius: String(clampedRadius),
  });
  if (opts.force) {
    qs.set('force', 'true');
  }

  try {
    const fetcher = opts.authFetch || fetch;
    const res = await fetcher(`/api/v1/amap/around?${qs.toString()}`);
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        return json.data as AreaSyncResponse;
      }
    }
  } catch {
    // ignore
  }
  return empty;
}

/**
 * 逆地理编码（坐标 → 中文详细地址，走纯后端缓存网关）
 */
export async function reverseGeocodeClient(
  lng: number,
  lat: number
): Promise<string> {
  if (typeof window === 'undefined') return '';

  try {
    const res = await fetch(
      `/api/v1/amap/around?mode=regeo&lng=${lng.toFixed(6)}&lat=${lat.toFixed(6)}`
    );
    if (res.ok) {
      const json = await res.json();
      if (json?.data?.address) return String(json.data.address);
    }
  } catch {
    // ignore
  }

  return `坐标 (${lng.toFixed(5)}, ${lat.toFixed(5)})`;
}

/**
 * 搜索地点 / 地标（走纯后端缓存网关）
 */
export async function searchPlaceClient(
  keyword: string,
  nearLng?: number,
  nearLat?: number
): Promise<PlaceSuggestion[]> {
  const kw = keyword.trim();
  if (!kw || typeof window === 'undefined') return [];

  try {
    const qs = new URLSearchParams({ keyword: kw });
    if (Number.isFinite(nearLng) && Number.isFinite(nearLat)) {
      qs.set('lng', Number(nearLng).toFixed(6));
      qs.set('lat', Number(nearLat).toFixed(6));
    }
    const res = await fetch(`/api/v1/amap/place?${qs.toString()}`);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data?.places)) {
        return json.data.places;
      }
    }
  } catch {
    // ignore
  }

  return [];
}

/**
 * 服务端高德 IP 城市级兜底定位（前端 0 Key 暴露）
 */
export async function locateByAmapIpClient(): Promise<{
  lng: number;
  lat: number;
  city: string;
} | null> {
  if (typeof window === 'undefined') return null;

  try {
    const res = await fetch('/api/v1/amap/around?mode=ip');
    if (res.ok) {
      const json = await res.json();
      if (json?.data?.location?.lng && json?.data?.location?.lat) {
        return json.data.location;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * 生成高德地图步行导航链接（URI 唤起，完全不消耗任何 API 配额）
 */
export function buildAMapWalkUrl(opts: {
  toLng: number;
  toLat: number;
  toName: string;
  fromLng?: number | null;
  fromLat?: number | null;
}): string {
  const params = new URLSearchParams();
  if (opts.fromLng && opts.fromLat) {
    params.set('from', `${opts.fromLng},${opts.fromLat},我的位置`);
  }
  params.set('to', `${opts.toLng},${opts.toLat},${opts.toName || '目标厕所'}`);
  params.set('mode', 'walk');
  params.set('callnative', '1');
  return `https://uri.amap.com/navigation?${params.toString()}`;
}
