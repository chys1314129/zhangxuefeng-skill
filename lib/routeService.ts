// lib/routeService.ts
// 高德地图「最短可行步行路线」精准测距与路径折线服务
// 结合 v3/distance?type=3 批量路网测距（单次最高100点）+ v3/direction/walking 单点最短可行路线规划 + 内存网格缓存

export interface RouteMetrics {
  distance: number; // 最短可行步行路线距离（米）
  duration: number; // 预计步行耗时（秒）
}

export interface WalkingRouteDetail extends RouteMetrics {
  polyline: [number, number][];
}

const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY || '';
const AMAP_SECURITY_CODE = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || '';

// 按用户位置 ~15 米网格缓存各目标厕所的真实步行路网距离，避免拖动地图时重复消耗 QPS
const metricsCache = new Map<string, RouteMetrics>();
const routeDetailCache = new Map<string, WalkingRouteDetail>();

function makeOriginBucket(lng: number, lat: number): string {
  return `${Math.round(lng * 6500)}_${Math.round(lat * 6500)}`;
}

function makeMetricsKey(userLng: number, userLat: number, toiletId: string): string {
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAmapJsonClient(
  url: string,
  timeoutMs = 4500
): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.infocode === '10021' && attempt === 0) {
        clearTimeout(timer);
        await sleep(520);
        continue;
      }
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
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
 * 批量计算用户当前定位到周边候选厕所的真实步行路网距离（绕开河流、湖泊、高架护栏、围墙等障碍）
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

  // 单批最多测算距离最近的 80 个未缓存点位（1 次高德 HTTP 调用即可完成）
  const batch = missing.slice(0, 80);
  let resolvedAny = false;

  if (AMAP_KEY) {
    const origins = batch
      .map((t) => `${t.lng.toFixed(6)},${t.lat.toFixed(6)}`)
      .join('|');
    const dest = `${userLng.toFixed(6)},${userLat.toFixed(6)}`;
    const url =
      `https://restapi.amap.com/v3/distance?key=${encodeURIComponent(AMAP_KEY)}` +
      `&origins=${encodeURIComponent(origins)}&destination=${encodeURIComponent(dest)}&type=3`;

    const data = await fetchAmapJsonClient(url, 4500);
    if (data?.status === '1' && Array.isArray(data.results)) {
      for (const r of data.results) {
        const idx = Number(r?.origin_id) - 1;
        const dist = Number(r?.distance);
        const dur = Number(r?.duration);
        if (
          idx >= 0 &&
          idx < batch.length &&
          Number.isFinite(dist) &&
          dist >= 0 &&
          !r?.info
        ) {
          const item = batch[idx];
          const m: RouteMetrics = {
            distance: Math.round(dist),
            duration:
              Number.isFinite(dur) && dur > 0
                ? Math.round(dur)
                : Math.max(60, Math.round(dist / 1.25)),
          };
          setCachedRouteMetrics(userLng, userLat, item.id, m);
          resultMap.set(item.id, m);
          resolvedAny = true;
        }
      }
    }
  }

  // 服务端代理回退（当仅在服务端运行时注入 Key 或跨域受限时自动兜底）
  if (!resolvedAny) {
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
  }

  return resultMap;
}

/**
 * 规划用户定位 -> 目标厕所的「最短可行步行路线」，返回精确路线米数、耗时秒数及地图折线坐标串
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

  let isJsKeyOnly = false;

  // 1. 高德 Web服务 v3/direction/walking（从所有候选步行方案中选出距离最短的一条可行路线）
  if (AMAP_KEY) {
    const url =
      `https://restapi.amap.com/v3/direction/walking?key=${encodeURIComponent(AMAP_KEY)}` +
      `&origin=${fromLng.toFixed(6)},${fromLat.toFixed(6)}` +
      `&destination=${toLng.toFixed(6)},${toLat.toFixed(6)}`;

    const data = await fetchAmapJsonClient(url, 4500);
    if (data?.infocode === '10009') {
      isJsKeyOnly = true;
    } else if (
      data?.status === '1' &&
      Array.isArray(data?.route?.paths) &&
      data.route.paths.length > 0
    ) {
      let bestPath = data.route.paths[0];
      for (const p of data.route.paths) {
        if (
          Number(p?.distance) >= 0 &&
          Number(p.distance) < Number(bestPath.distance)
        ) {
          bestPath = p;
        }
      }

      const distance = Math.round(Number(bestPath?.distance || 0));
      const rawDur = Number(bestPath?.duration || 0);
      const duration =
        Number.isFinite(rawDur) && rawDur > 0
          ? Math.round(rawDur)
          : Math.max(60, Math.round(distance / 1.25));

      const polyline: [number, number][] = [];
      if (Array.isArray(bestPath?.steps)) {
        for (const step of bestPath.steps) {
          const rawPoly =
            typeof step?.polyline === 'string' ? step.polyline : '';
          if (!rawPoly) continue;
          for (const pair of rawPoly.split(';')) {
            const [lng, lat] = pair.split(',').map(Number);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
              const prev = polyline[polyline.length - 1];
              if (!prev || prev[0] !== lng || prev[1] !== lat) {
                polyline.push([lng, lat]);
              }
            }
          }
        }
      }

      const detail: WalkingRouteDetail = { distance, duration, polyline };
      routeDetailCache.set(detailKey, detail);
      if (toiletId) {
        setCachedRouteMetrics(fromLng, fromLat, toiletId, {
          distance,
          duration,
        });
      }
      return detail;
    }
  }

  // 2. 高德 JS SDK AMap.Walking 兜底（兼容纯 Web端 JS API Key）
  if (isJsKeyOnly && AMAP_KEY) {
    try {
      if (AMAP_SECURITY_CODE) {
        (window as any)._AMapSecurityConfig = {
          securityJsCode: AMAP_SECURITY_CODE,
        };
      }
      const mod = await import('@amap/amap-jsapi-loader');
      const AMapLoader = mod.default || mod;
      const AMap = await AMapLoader.load({
        key: AMAP_KEY,
        version: '2.0',
        plugins: ['AMap.Walking'],
      });
      if (AMap?.Walking) {
        const sdkDetail = await new Promise<WalkingRouteDetail | null>(
          (resolve) => {
            const walking = new AMap.Walking();
            const timer = setTimeout(() => resolve(null), 4500);
            walking.search(
              [fromLng, fromLat],
              [toLng, toLat],
              (status: string, result: any) => {
                clearTimeout(timer);
                const routes = result?.routes;
                if (
                  status === 'complete' &&
                  Array.isArray(routes) &&
                  routes.length > 0
                ) {
                  let best = routes[0];
                  for (const r of routes) {
                    if (Number(r.distance) < Number(best.distance)) best = r;
                  }
                  const pts: [number, number][] = [];
                  for (const step of best.steps || []) {
                    for (const p of step.path || []) {
                      const lng = Number(p.lng ?? p.getLng?.());
                      const lat = Number(p.lat ?? p.getLat?.());
                      if (Number.isFinite(lng) && Number.isFinite(lat)) {
                        pts.push([lng, lat]);
                      }
                    }
                  }
                  resolve({
                    distance: Math.round(Number(best.distance || 0)),
                    duration: Math.round(Number(best.time || 60)),
                    polyline: pts,
                  });
                } else {
                  resolve(null);
                }
              }
            );
          }
        );
        if (sdkDetail) {
          routeDetailCache.set(detailKey, sdkDetail);
          if (toiletId) {
            setCachedRouteMetrics(fromLng, fromLat, toiletId, {
              distance: sdkDetail.distance,
              duration: sdkDetail.duration,
            });
          }
          return sdkDetail;
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. 服务端代理兜底
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
