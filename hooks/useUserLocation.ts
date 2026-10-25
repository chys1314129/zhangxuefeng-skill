'use client';

import { useCallback, useEffect, useState } from 'react';
import { isInGreaterChina, wgs84ToGcj02 } from '@/lib/geo';

export interface UserCoords {
  lng: number;
  lat: number;
  inChina: boolean;
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserCoords | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setError('当前浏览器不支持地理定位');
      setLoading(false);
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const rawLng = position.coords.longitude;
        const rawLat = position.coords.latitude;
        const inChina = isInGreaterChina(rawLng, rawLat);
        const converted = wgs84ToGcj02(rawLng, rawLat);
        setLocation({
          lng: converted.lng,
          lat: converted.lat,
          inChina,
        });
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message || '定位权限未开启');
        setLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  return { location, loading, error, requestLocation };
}
