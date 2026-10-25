'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/hooks/useAuth';
import {
  DiscoveredPOI,
  searchNearbyToiletPOIsClient,
} from '@/lib/mapService';
import type { MapBounds, ToiletItem } from '@/types';

export interface ToiletFilters {
  isFree?: boolean;
  hasPaper?: boolean;
  hasAccessible?: boolean;
  onlyMine?: boolean;
  keyword?: string;
}

interface UseToiletsParams {
  lng?: number;
  lat?: number;
  radius?: number;
  bounds?: MapBounds | null;
  filters?: ToiletFilters;
}

function makeGridKey(
  lng: number,
  lat: number,
  bounds?: MapBounds | null
): string {
  // 约 220m 网格粒度 + 视野跨度分桶，确保平移或缩放至新街区时自动补全周边公厕
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
  radius = 3500,
  bounds = null,
  filters = {},
}: UseToiletsParams) {
  const { user, authFetch } = useAuth();
  const syncedCellsRef = useRef<Set<string>>(new Set());
  const [isSyncingPois, setIsSyncingPois] = useState(false);

  const queryParams = new URLSearchParams();
  if (lng !== undefined && lat !== undefined) {
    queryParams.set('lng', lng.toFixed(6));
    queryParams.set('lat', lat.toFixed(6));
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
      dedupingInterval: 1500,
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

        // 仅当真正拿到 POI 数据后才记录该网格已完成，防止偶发网络抖动导致该区域永久漏加载
        if (allPois.length > 0) {
          syncedCellsRef.current.add(cellKey);
          mutate();
        }
        return allPois.length;
      } finally {
        setIsSyncingPois(false);
      }
    },
    [mutate, syncWaveToServer]
  );

  // 自动检索并融合当前视野内的高德真实公厕 POI
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

  const refreshAreaPois = useCallback(async () => {
    if (lng === undefined || lat === undefined) return 0;
    const count = await runPoiDiscovery(lng, lat, radius, bounds, true);
    await mutate();
    return count;
  }, [lng, lat, radius, bounds, runPoiDiscovery, mutate]);

  const toilets: ToiletItem[] = data?.data?.toilets || [];
  const nearest: ToiletItem | null = toilets.length > 0 ? toilets[0] : null;

  return {
    toilets,
    nearest,
    total: data?.data?.total || toilets.length,
    isLoading,
    isSyncingPois,
    error,
    mutate,
    refreshAreaPois,
  };
}
