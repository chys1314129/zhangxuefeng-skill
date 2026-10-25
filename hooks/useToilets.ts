'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/hooks/useAuth';
import { haversineDistance } from '@/lib/geo';
import {
  syncInferredVenuesSharedClient,
  syncNearbyToiletsSharedClient,
} from '@/lib/mapService';
import {
  batchMeasureWalkingRoutesClient,
  fetchShortestWalkingRouteClient,
  getCachedRouteMetrics,
} from '@/lib/routeService';
import type { InferredCategory, MapBounds, ToiletItem } from '@/types';

export interface ToiletFilters {
  isFree?: boolean;
  hasPaper?: boolean;
  hasAccessible?: boolean;
  onlyMine?: boolean;
  keyword?: string;
  includeInferred?: boolean;
  inferredCategory?: InferredCategory | 'ALL';
}

interface UseToiletsParams {
  lng?: number;
  lat?: number;
  userLocation?: { lng: number; lat: number; inChina?: boolean } | null;
  radius?: number;
  bounds?: MapBounds | null;
  filters?: ToiletFilters;
}

// 与服务端共享区域冷却网格对齐（约 1.1km × 1.1km 街区网格）
function makeSharedGridKey(lng: number, lat: number): string {
  return `${Math.round(lng * 90)}_${Math.round(lat * 90)}`;
}

const CLIENT_CHECK_TTL_MS = 10 * 60 * 1000;

export function useToilets({
  lng,
  lat,
  userLocation = null,
  radius = 3500,
  bounds = null,
  filters = {},
}: UseToiletsParams) {
  const { user, authFetch } = useAuth();
  const syncedCellsRef = useRef<Map<string, number>>(new Map());
  const syncedInferredCellsRef = useRef<Map<string, number>>(new Map());
  const [isSyncingPois, setIsSyncingPois] = useState(false);
  const [isSyncingInferred, setIsSyncingInferred] = useState(false);
  const [hasCompletedInitialScan, setHasCompletedInitialScan] = useState(false);
  const [routeTick, setRouteTick] = useState(0);

  // 测距基准原点：始终优先以「用户真实定位」为准；仅在无定位时回退至地图中心
  const distOrigin = useMemo(() => {
    if (
      userLocation &&
      userLocation.inChina !== false &&
      Number.isFinite(userLocation.lng) &&
      Number.isFinite(userLocation.lat)
    ) {
      return { lng: userLocation.lng, lat: userLocation.lat };
    }
    if (lng !== undefined && lat !== undefined) {
      return { lng, lat };
    }
    return null;
  }, [userLocation, lng, lat]);

  const queryParams = new URLSearchParams();
  if (lng !== undefined && lat !== undefined) {
    queryParams.set('lng', lng.toFixed(6));
    queryParams.set('lat', lat.toFixed(6));
    if (distOrigin) {
      queryParams.set('userLng', distOrigin.lng.toFixed(6));
      queryParams.set('userLat', distOrigin.lat.toFixed(6));
    }
    queryParams.set('radius', String(radius));
    queryParams.set('limit', '350');
    if (bounds) {
      queryParams.set('minLng', bounds.minLng.toFixed(5));
      queryParams.set('minLat', bounds.minLat.toFixed(5));
      queryParams.set('maxLng', bounds.maxLng.toFixed(5));
      queryParams.set('maxLat', bounds.maxLat.toFixed(5));
    }
    if (filters.isFree) queryParams.set('isFree', 'true');
    if (filters.hasPaper) queryParams.set('hasPaper', 'true');
    if (filters.hasAccessible) queryParams.set('hasAccessible', 'true');
    if (filters.onlyMine) queryParams.set('onlyMine', 'true');
    if (filters.includeInferred) {
      queryParams.set('includeInferred', 'true');
      if (filters.inferredCategory && filters.inferredCategory !== 'ALL') {
        queryParams.set('inferredCategory', filters.inferredCategory);
      }
    }
    if (filters.keyword?.trim()) {
      queryParams.set('keyword', filters.keyword.trim());
    }
  }

  const swrKey =
    lng !== undefined && lat !== undefined
      ? [`/api/v1/toilets?${queryParams.toString()}`, user?.id || 'guest']
      : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    async ([url]) => {
      const res = await authFetch(url);
      return res.json();
    },
    {
      refreshInterval: 30000,
      dedupingInterval: 1200,
      keepPreviousData: true,
    }
  );

  const runPoiDiscovery = useCallback(
    async (
      targetLng: number,
      targetLat: number,
      targetRadius: number,
      targetBounds: MapBounds | null,
      force = false
    ): Promise<number> => {
      const cellKey = makeSharedGridKey(targetLng, targetLat);
      const lastCheckTs = syncedCellsRef.current.get(cellKey) || 0;
      if (
        !force &&
        lastCheckTs > 0 &&
        Date.now() - lastCheckTs < CLIENT_CHECK_TTL_MS
      ) {
        setHasCompletedInitialScan(true);
        return 0;
      }

      setIsSyncingPois(true);
      try {
        const res = await syncNearbyToiletsSharedClient({
          lng: targetLng,
          lat: targetLat,
          radius: Math.min(Math.max(targetRadius, 2500), 8000),
          bounds: targetBounds,
          force,
          authFetch,
        });

        syncedCellsRef.current.set(cellKey, Date.now());
        if (res.synced + res.updated + res.retired > 0) {
          await mutate();
        }
        return res.poiCount;
      } finally {
        setIsSyncingPois(false);
        setHasCompletedInitialScan(true);
      }
    },
    [authFetch, mutate]
  );

  const runInferredDiscovery = useCallback(
    async (
      targetLng: number,
      targetLat: number,
      targetRadius: number,
      force = false
    ): Promise<number> => {
      const cellKey = makeSharedGridKey(targetLng, targetLat);
      const lastCheckTs = syncedInferredCellsRef.current.get(cellKey) || 0;
      if (
        !force &&
        lastCheckTs > 0 &&
        Date.now() - lastCheckTs < CLIENT_CHECK_TTL_MS
      ) {
        return 0;
      }

      setIsSyncingInferred(true);
      try {
        const res = await syncInferredVenuesSharedClient({
          lng: targetLng,
          lat: targetLat,
          radius: Math.min(Math.max(targetRadius, 1800), 5000),
          force,
          authFetch,
        });

        syncedInferredCellsRef.current.set(cellKey, Date.now());
        if (res.syncedInferred + res.updated > 0) {
          await mutate();
        }
        return res.poiCount;
      } finally {
        setIsSyncingInferred(false);
      }
    },
    [authFetch, mutate]
  );

  useEffect(() => {
    if (lng === undefined || lat === undefined) return;
    if (filters.onlyMine) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void runPoiDiscovery(lng, lat, radius, bounds, false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    lng,
    lat,
    radius,
    bounds?.minLng,
    bounds?.minLat,
    bounds?.maxLng,
    bounds?.maxLat,
    filters.onlyMine,
    runPoiDiscovery,
  ]);

  useEffect(() => {
    if (lng === undefined || lat === undefined) return;
    if (!filters.includeInferred || filters.onlyMine) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void runInferredDiscovery(lng, lat, radius, false);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    lng,
    lat,
    radius,
    filters.includeInferred,
    filters.onlyMine,
    runInferredDiscovery,
  ]);

  const rawToilets: ToiletItem[] = data?.data?.toilets || [];

  // 通过纯后端缓存网关批量计算「用户定位 -> 各候选厕所」的最短可行步行路网距离
  useEffect(() => {
    if (!distOrigin || rawToilets.length === 0) return;

    const uLng = distOrigin.lng;
    const uLat = distOrigin.lat;

    // 精选直线 8km 内最近的最多 45 个点位测算步行路网（大幅节省配额，且服务端共享 ~35m 起点网格缓存）
    const walkable = rawToilets
      .map((t) => ({
        id: t.id,
        lng: t.lng,
        lat: t.lat,
        source: t.source,
        sDist: haversineDistance(uLng, uLat, t.lng, t.lat),
      }))
      .filter((t) => t.sDist <= 8000)
      .sort((a, b) => a.sDist - b.sDist)
      .slice(0, 45);

    if (walkable.length === 0) return;

    const hasUncached = walkable.some(
      (t) => !getCachedRouteMetrics(uLng, uLat, t.id)
    );
    if (!hasUncached) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const measured = await batchMeasureWalkingRoutesClient(
        uLng,
        uLat,
        walkable
      );
      if (cancelled) return;
      if (measured.size > 0) {
        setRouteTick((v) => v + 1);
      }

      const topConfirmed = walkable
        .filter((w) => w.source !== 'INFERRED')
        .sort((a, b) => {
          const da = getCachedRouteMetrics(uLng, uLat, a.id)?.distance ?? a.sDist;
          const db = getCachedRouteMetrics(uLng, uLat, b.id)?.distance ?? b.sDist;
          return da - db;
        })[0];

      if (topConfirmed && !cancelled) {
        const exact = await fetchShortestWalkingRouteClient(
          uLng,
          uLat,
          topConfirmed.lng,
          topConfirmed.lat,
          topConfirmed.id
        );
        if (exact && !cancelled) {
          setRouteTick((v) => v + 1);
        }
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [distOrigin?.lng, distOrigin?.lat, rawToilets]);

  const toilets: ToiletItem[] = useMemo(() => {
    void routeTick;
    if (!distOrigin) return rawToilets;

    const uLng = distOrigin.lng;
    const uLat = distOrigin.lat;

    const enriched = rawToilets.map((t) => {
      const straight = haversineDistance(uLng, uLat, t.lng, t.lat);
      const route = getCachedRouteMetrics(uLng, uLat, t.id);
      if (route) {
        return {
          ...t,
          straightDistance: straight,
          distance: route.distance,
          walkDuration: route.duration,
          isRouteDistance: true,
        };
      }
      return {
        ...t,
        straightDistance: straight,
        distance: straight,
        isRouteDistance: false,
      };
    });

    enriched.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return enriched;
  }, [rawToilets, distOrigin, routeTick]);

  const refreshAreaPois = useCallback(async () => {
    if (lng === undefined || lat === undefined) return 0;
    const count = await runPoiDiscovery(lng, lat, radius, bounds, true);
    let infCount = 0;
    if (filters.includeInferred) {
      infCount = await runInferredDiscovery(lng, lat, radius, true);
    }
    await mutate();
    return count + infCount;
  }, [
    lng,
    lat,
    radius,
    bounds,
    filters.includeInferred,
    runPoiDiscovery,
    runInferredDiscovery,
    mutate,
  ]);

  const confirmedWithin500m: number | undefined =
    typeof data?.data?.confirmedWithin500m === 'number'
      ? data.data.confirmedWithin500m
      : undefined;

  const nearestConfirmed: ToiletItem | null = useMemo(
    () => toilets.find((t) => t.source !== 'INFERRED') || null,
    [toilets]
  );

  const nearest: ToiletItem | null = useMemo(() => {
    if (
      nearestConfirmed &&
      (nearestConfirmed.distance === undefined ||
        nearestConfirmed.distance <= 900 ||
        !toilets[0] ||
        toilets[0].source !== 'INFERRED')
    ) {
      return nearestConfirmed;
    }
    return toilets[0] || nearestConfirmed || null;
  }, [nearestConfirmed, toilets]);

  const notifyRouteUpdated = useCallback(() => {
    setRouteTick((v) => v + 1);
  }, []);

  return {
    toilets,
    nearest,
    nearestConfirmed,
    confirmedWithin500m,
    hasCompletedInitialScan,
    total: data?.data?.total || toilets.length,
    isLoading,
    isSyncingPois: isSyncingPois || isSyncingInferred,
    isSyncingInferred,
    error,
    mutate,
    refreshAreaPois,
    notifyRouteUpdated,
  };
}
