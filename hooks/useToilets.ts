'use client';

import { useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/hooks/useAuth';
import { haversineDistance } from '@/lib/geo';
import { searchNearbyToiletPOIsClient } from '@/lib/mapService';
import type { ToiletItem } from '@/types';

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
  filters?: ToiletFilters;
}

export function useToilets({
  lng,
  lat,
  radius = 2500,
  filters = {},
}: UseToiletsParams) {
  const { user, authFetch } = useAuth();
  const lastPoiSyncCenterRef = useRef<{ lng: number; lat: number } | null>(null);

  const queryParams = new URLSearchParams();
  if (lng !== undefined && lat !== undefined) {
    queryParams.set('lng', lng.toFixed(6));
    queryParams.set('lat', lat.toFixed(6));
    queryParams.set('radius', String(radius));
    if (filters.isFree) queryParams.set('isFree', 'true');
    if (filters.hasPaper) queryParams.set('hasPaper', 'true');
    if (filters.hasAccessible) queryParams.set('hasAccessible', 'true');
    if (filters.onlyMine) queryParams.set('onlyMine', 'true');
    if (filters.keyword?.trim()) queryParams.set('keyword', filters.keyword.trim());
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
      dedupingInterval: 2500,
      keepPreviousData: true,
    }
  );

  // 自动融合高德/腾讯周边真实公厕 POI 并异步持久化到本地库
  useEffect(() => {
    if (lng === undefined || lat === undefined) return;
    if (filters.onlyMine) return;

    const prev = lastPoiSyncCenterRef.current;
    if (prev && haversineDistance(prev.lng, prev.lat, lng, lat) < 350) {
      return;
    }
    lastPoiSyncCenterRef.current = { lng, lat };

    let cancelled = false;
    const timer = setTimeout(async () => {
      const pois = await searchNearbyToiletPOIsClient(lng, lat, Math.min(radius, 3000));
      if (cancelled || pois.length === 0) return;

      try {
        const res = await fetch('/api/v1/toilets/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pois }),
        });
        const json = await res.json();
        if (!cancelled && json?.data?.synced > 0) {
          mutate();
        }
      } catch {
        // ignore background sync failures
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lng, lat, radius, filters.onlyMine, mutate]);

  const toilets: ToiletItem[] = data?.data?.toilets || [];
  const nearest: ToiletItem | null = toilets.length > 0 ? toilets[0] : null;

  return {
    toilets,
    nearest,
    total: data?.data?.total || toilets.length,
    isLoading,
    error,
    mutate,
  };
}
