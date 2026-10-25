// lib/routeService.ts
// 纯后端代理「最短可行步行路线」测距与折线服务：
// - 前端 0 高德 Key 暴露
// - 双重缓存（浏览器本地网格缓存 + 服务端全站 ~35m 共享起点网格缓存）

export interface RouteMetrics {
  distance: number; // 最短可行步行路线距离（米）
  duration: number; // 预计步行耗时（秒）
}

export interface WalkingRouteDetail extends RouteMetrics {
  polyline: [number, number][];
}

// 浏览器会话内按用户定位 ~15m 网格缓存，避免切换筛选或重绘时重复请求
const metricsCache = new Map<string, RouteMetrics>();
const routeDetailCache = new Map<string, WalkingRouteDetail>();

function makeOriginBucket(lng: number, lat: number): string {
  return `${Math.round(lng * 6500)}_${Math.round(lat * 6500)}`;
}

function makeMetricsKey(
  userLng: number,
  userLat: number,
  toiletId: string
): string {
  return `${makeOriginBucket(userLng, userLat)}::${toiletId}`;
}

function makeRouteDetailKey(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number
): string {
  return `${makeOriginBucket(fromLng, fromLat)}->${toLng.toFixed(5)},${toLat.toFixed(5)}`;
}

export function getCachedRouteMetrics(
  userLng: number,
  userLat: number,
  toiletId: string
): RouteMetrics | null {
  return metricsCache.get(makeMetricsKey(userLng, userLat, toiletId)) || null;
}

export function setCachedRouteMetrics(
  userLng: number,
  userLat: number,
  toiletId: string,
  metrics: RouteMetrics
) {
  if (metricsCache.size > 3000) {
    metricsCache.clear();
  }
  metricsCache.set(makeMetricsKey(userLng, userLat, toiletId), metrics);
}

/**
 * 批量计算用户当前定位到周边候选厕所的真实步行路网距离（纯后端代理 + 全站共享缓存）
 */
export async function batchMeasureWalkingRoutesClient(
  userLng: number,
  userLat: number,
  targets: { id: string; lng: number; lat: number }[]
): Promise<Map<string, RouteMetrics>> {
  const resultMap = new Map<string, RouteMetrics>();
  if (typeof window === 'undefined' || !targets.length) return resultMap;

  const missing: { id: string; lng: number; lat: number }[] = [];
  for (const t of targets) {
    const cached = getCachedRouteMetrics(userLng, userLat, t.id);
    if (cached) {
      resultMap.set(t.id, cached);
    } else {
      missing.push(t);
    }
  }

  if (missing.length === 0) {
    return resultMap;
  }

  const batch = missing.slice(0, 80);

  try {
    const res = await fetch('/api/v1/amap/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userLng,
        userLat,
        targets: batch,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const list = Array.isArray(json?.data?.results)
        ? json.data.results
        : [];
      for (const entry of list) {
        if (entry?.id && Number.isFinite(Number(entry.distance))) {
          const m: RouteMetrics = {
            distance: Math.round(Number(entry.distance)),
            duration: Math.round(Number(entry.duration || 60)),
          };
          setCachedRouteMetrics(userLng, userLat, String(entry.id), m);
          resultMap.set(String(entry.id), m);
        }
      }
    }
  } catch {
    // ignore
  }

  return resultMap;
}

/**
 * 规划用户定位 -> 目标厕所的「最短可行步行路线」，返回精确路线米数、耗时秒数及地图折线坐标串（纯后端代理）
 */
export async function fetchShortestWalkingRouteClient(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  toiletId?: string
): Promise<WalkingRouteDetail | null> {
  if (typeof window === 'undefined') return null;

  const detailKey = makeRouteDetailKey(fromLng, fromLat, toLng, toLat);
  const cached = routeDetailCache.get(detailKey);
  if (cached) {
    if (toiletId) {
      setCachedRouteMetrics(fromLng, fromLat, toiletId, {
        distance: cached.distance,
        duration: cached.duration,
      });
    }
    return cached;
  }

  try {
    const qs = new URLSearchParams({
      fromLng: fromLng.toFixed(6),
      fromLat: fromLat.toFixed(6),
      toLng: toLng.toFixed(6),
      toLat: toLat.toFixed(6),
    });
    const res = await fetch(`/api/v1/amap/route?${qs.toString()}`);
    if (res.ok) {
      const json = await res.json();
      const route = json?.data?.route as WalkingRouteDetail | null;
      if (route && Number.isFinite(route.distance)) {
        routeDetailCache.set(detailKey, route);
        if (toiletId) {
          setCachedRouteMetrics(fromLng, fromLat, toiletId, {
            distance: route.distance,
            duration: route.duration,
          });
        }
        return route;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export function formatWalkMinutes(
  walkDurationSeconds?: number | null,
  fallbackMeters?: number | null
): number {
  if (walkDurationSeconds && walkDurationSeconds > 0) {
    return Math.max(1, Math.round(walkDurationSeconds / 60));
  }
  if (!fallbackMeters || fallbackMeters <= 0) return 1;
  return Math.max(1, Math.round(fallbackMeters / 75));
}
