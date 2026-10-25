'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/hooks/useAuth';
import { haversineDistance } from '@/lib/geo';
import type { DiscoveredInferredVenue } from '@/lib/inferredVenues';
import {
  DiscoveredPOI,
  searchInferredVenuePOIsClient,
  searchNearbyToiletPOIsClient,
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

function makeGridKey(
  lng: number,
  lat: number,
  bounds?: MapBounds | null
): string {
  const gLng = Math.round(lng * 400);
  const gLat = Math.round(lat * 400);
  const span = bounds
    ? Math.round((bounds.maxLng - bounds.minLng) * 100)
    : 0;
  return `${gLng}_${gLat}_${span}`;
}

export function useToilets({
  lng,
  lat,
  userLocation = null,
  radius = 3500,
  bounds = null,
  filters = {},
}: UseToiletsParams) {
  const { user, authFetch } = useAuth();
  const syncedCellsRef = useRef<Set<string>>(new Set());
  const syncedInferredCellsRef = useRef<Set<string>>(new Set());
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

  const syncWaveToServer = useCallback(
    async (wavePois: DiscoveredPOI[]) => {
      if (!wavePois.length) return 0;
      try {
        const res = await fetch('/api/v1/toilets/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pois: wavePois }),
        });
        const json = await res.json();
        const syncedCount = Number(json?.data?.synced || 0);
        if (syncedCount > 0) {
          mutate();
        }
        return syncedCount;
      } catch {
        return 0;
      }
    },
    [mutate]
  );

  const syncInferredToServer = useCallback(
    async (venues: DiscoveredInferredVenue[]) => {
      if (!venues.length) return 0;
      try {
        const res = await fetch('/api/v1/toilets/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inferredVenues: venues }),
        });
        const json = await res.json();
        const syncedCount = Number(json?.data?.syncedInferred || 0);
        if (syncedCount > 0) {
          mutate();
        }
        return syncedCount;
      } catch {
        return 0;
      }
    },
    [mutate]
  );

  const runPoiDiscovery = useCallback(
    async (
      targetLng: number,
      targetLat: number,
      targetRadius: number,
      targetBounds: MapBounds | null,
      force = false
    ): Promise<number> => {
      const cellKey = makeGridKey(targetLng, targetLat, targetBounds);
      if (!force && syncedCellsRef.current.has(cellKey)) {
        setHasCompletedInitialScan(true);
        return 0;
      }

      setIsSyncingPois(true);
      try {
        const allPois = await searchNearbyToiletPOIsClient(
          targetLng,
          targetLat,
          Math.min(Math.max(targetRadius, 2500), 8000),
          targetBounds,
          (wavePois) => {
            void syncWaveToServer(wavePois);
          }
        );

        if (allPois.length > 0) {
          syncedCellsRef.current.add(cellKey);
          await mutate();
        }
        return allPois.length;
      } finally {
        setIsSyncingPois(false);
        setHasCompletedInitialScan(true);
      }
    },
    [mutate, syncWaveToServer]
  );

  const runInferredDiscovery = useCallback(
    async (
      targetLng: number,
      targetLat: number,
      targetRadius: number,
      force = false
    ): Promise<number> => {
      const cellKey = `${Math.round(targetLng * 300)}_${Math.round(targetLat * 300)}`;
      if (!force && syncedInferredCellsRef.current.has(cellKey)) {
        return 0;
      }

      setIsSyncingInferred(true);
      try {
        const venues = await searchInferredVenuePOIsClient(
          targetLng,
          targetLat,
          Math.min(Math.max(targetRadius, 1800), 5000)
        );
        if (venues.length > 0) {
          syncedInferredCellsRef.current.add(cellKey);
          await syncInferredToServer(venues);
          await mutate();
        }
        return venues.length;
      } finally {
        setIsSyncingInferred(false);
      }
    },
    [mutate, syncInferredToServer]
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
    }, 480);

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

  // 异步调用高德步行路网 API 批量计算「用户定位 -> 各目标厕所」的最短可行路线距离（绕开江河湖泊、围墙与护栏）
  useEffect(() => {
    if (!distOrigin || rawToilets.length === 0) return;

    const uLng = distOrigin.lng;
    const uLat = distOrigin.lat;

    // 筛选直线距离 9.5km 内的可步行候选点（按直线距离由近到远优先测算）
    const walkable = rawToilets
      .map((t) => ({
        id: t.id,
        lng: t.lng,
        lat: t.lat,
        source: t.source,
        sDist: haversineDistance(uLng, uLat, t.lng, t.lat),
      }))
      .filter((t) => t.sDist <= 9500)
      .sort((a, b) => a.sDist - b.sDist);

    if (walkable.length === 0) return;

    const hasUncached = walkable
      .slice(0, 80)
      .some((t) => !getCachedRouteMetrics(uLng, uLat, t.id));
    if (!hasUncached) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const measured = await batchMeasureWalkingRoutesClient(
        uLng,
        uLat,
        walkable.slice(0, 80)
      );
      if (cancelled) return;
      if (measured.size > 0) {
        setRouteTick((v) => v + 1);
      }

      // 对当前路网距离排第一的最近点位再执行一次正向 v3/direction/walking 最短方案核验
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
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [distOrigin?.lng, distOrigin?.lat, rawToilets]);

  // 融合高德最短可行路线距离并重新按真实路线距离由近到远排序
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
