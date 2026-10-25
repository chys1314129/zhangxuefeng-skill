// lib/mapService.ts
// 浏览器端高德地图 + 腾讯地图混合服务层（POI周边公厕检索、关键词地点搜索、逆地理编码、一键步行导航）

export interface DiscoveredPOI {
  externalId: string;
  name: string;
  lng: number;
  lat: number;
  address: string;
  provider: 'amap' | 'tmap';
}

export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
}

const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY || '';
const TMAP_KEY = process.env.NEXT_PUBLIC_TMAP_KEY || '';

/**
 * 通用 JSONP 请求工具（用于腾讯地图 WebService 跨域调用）
 */
function fetchJsonp<T = any>(url: string, timeoutMs = 6000): Promise<T | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const callbackName = `__tmap_cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      try {
        delete (window as any)[callbackName];
      } catch {
        (window as any)[callbackName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    }, timeoutMs);

    (window as any)[callbackName] = (data: T) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        cleanup();
        resolve(data);
      }
    };

    script.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        cleanup();
        resolve(null);
      }
    };

    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}output=jsonp&callback=${callbackName}`;
    document.body.appendChild(script);
  });
}

async function fetchWithTimeout(url: string, timeoutMs = 5500): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 搜索周边公共厕所真实 POI（优先高德 REST / JS，自动回退腾讯地图）
 */
export async function searchNearbyToiletPOIsClient(
  lng: number,
  lat: number,
  radius = 2000
): Promise<DiscoveredPOI[]> {
  if (typeof window === 'undefined') return [];

  // 1. 尝试高德 Web服务 REST API (POI分类 200300 = 公共厕所)
  if (AMAP_KEY) {
    const amapUrl =
      `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(AMAP_KEY)}` +
      `&location=${lng.toFixed(6)},${lat.toFixed(6)}` +
      `&radius=${Math.min(radius, 5000)}&types=200300&offset=35&page=1&extensions=base`;

    const data = await fetchWithTimeout(amapUrl);
    if (data && data.status === '1' && Array.isArray(data.pois) && data.pois.length > 0) {
      return data.pois
        .map((poi: any) => {
          const [pLng, pLat] = String(poi.location || '').split(',').map(Number);
          if (!pLng || !pLat) return null;
          return {
            externalId: `amap_${poi.id}`,
            name: String(poi.name || '公共厕所'),
            lng: pLng,
            lat: pLat,
            address: typeof poi.address === 'string' ? poi.address : '',
            provider: 'amap' as const,
          };
        })
        .filter(Boolean) as DiscoveredPOI[];
    }
  }

  // 2. 如果已加载高德 JS SDK PlaceSearch 插件，尝试使用 JS SDK 检索
  const AMapGlobal = (window as any).AMap;
  if (AMapGlobal?.PlaceSearch) {
    const sdkResult = await new Promise<DiscoveredPOI[]>((resolve) => {
      try {
        const ps = new AMapGlobal.PlaceSearch({
          type: '公共厕所',
          pageSize: 30,
          pageIndex: 1,
        });
        const timer = setTimeout(() => resolve([]), 4500);
        ps.searchNearBy(
          '',
          [lng, lat],
          Math.min(radius, 5000),
          (status: string, result: any) => {
            clearTimeout(timer);
            if (status === 'complete' && result?.poiList?.pois) {
              const items = result.poiList.pois
                .map((poi: any) => {
                  const pLng = poi.location?.lng ?? poi.location?.getLng?.();
                  const pLat = poi.location?.lat ?? poi.location?.getLat?.();
                  if (!pLng || !pLat) return null;
                  return {
                    externalId: `amap_${poi.id}`,
                    name: String(poi.name || '公共厕所'),
                    lng: Number(pLng),
                    lat: Number(pLat),
                    address: typeof poi.address === 'string' ? poi.address : '',
                    provider: 'amap' as const,
                  };
                })
                .filter(Boolean);
              resolve(items);
            } else {
              resolve([]);
            }
          }
        );
      } catch {
        resolve([]);
      }
    });
    if (sdkResult.length > 0) return sdkResult;
  }

  // 3. 回退到腾讯地图周边检索 JSONP
  if (TMAP_KEY) {
    const tmapUrl =
      `https://apis.map.qq.com/ws/place/v1/search?key=${encodeURIComponent(TMAP_KEY)}` +
      `&keyword=${encodeURIComponent('公共厕所')}` +
      `&boundary=nearby(${lat.toFixed(6)},${lng.toFixed(6)},${Math.min(radius, 5000)},1)` +
      `&page_size=20&page_index=1`;

    const tData = await fetchJsonp<any>(tmapUrl);
    if (tData && tData.status === 0 && Array.isArray(tData.data) && tData.data.length > 0) {
      return tData.data
        .map((item: any) => {
          const pLat = Number(item.location?.lat);
          const pLng = Number(item.location?.lng);
          if (!pLat || !pLng) return null;
          return {
            externalId: `tmap_${item.id}`,
            name: String(item.title || '公共厕所'),
            lng: pLng,
            lat: pLat,
            address: String(item.address || ''),
            provider: 'tmap' as const,
          };
        })
        .filter(Boolean) as DiscoveredPOI[];
    }
  }

  return [];
}

/**
 * 逆地理编码（坐标 → 中文详细地址）
 */
export async function reverseGeocodeClient(
  lng: number,
  lat: number
): Promise<string> {
  if (typeof window === 'undefined') return '';

  // 1. 高德 REST 逆地理编码
  if (AMAP_KEY) {
    const url =
      `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(AMAP_KEY)}` +
      `&location=${lng.toFixed(6)},${lat.toFixed(6)}&extensions=base`;
    const data = await fetchWithTimeout(url, 4500);
    if (data?.status === '1' && typeof data.regeocode?.formatted_address === 'string') {
      return data.regeocode.formatted_address;
    }
  }

  // 2. 高德 JS SDK Geocoder
  const AMapGlobal = (window as any).AMap;
  if (AMapGlobal?.Geocoder) {
    const addr = await new Promise<string>((resolve) => {
      try {
        const geocoder = new AMapGlobal.Geocoder();
        const timer = setTimeout(() => resolve(''), 3500);
        geocoder.getAddress([lng, lat], (status: string, result: any) => {
          clearTimeout(timer);
          if (status === 'complete' && result?.regeocode?.formattedAddress) {
            resolve(String(result.regeocode.formattedAddress));
          } else {
            resolve('');
          }
        });
      } catch {
        resolve('');
      }
    });
    if (addr) return addr;
  }

  // 3. 腾讯地图逆地理编码 JSONP
  if (TMAP_KEY) {
    const tUrl =
      `https://apis.map.qq.com/ws/geocoder/v1/?key=${encodeURIComponent(TMAP_KEY)}` +
      `&location=${lat.toFixed(6)},${lng.toFixed(6)}`;
    const tData = await fetchJsonp<any>(tUrl, 4500);
    if (tData?.status === 0 && tData.result?.address) {
      return String(tData.result.address);
    }
  }

  return `坐标 (${lng.toFixed(5)}, ${lat.toFixed(5)})`;
}

/**
 * 搜索地点 / 地标（用于在地图上跳转到任意商圈或位置）
 */
export async function searchPlaceClient(keyword: string): Promise<PlaceSuggestion[]> {
  const kw = keyword.trim();
  if (!kw || typeof window === 'undefined') return [];

  // 1. 高德关键字搜索
  if (AMAP_KEY) {
    const url =
      `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(AMAP_KEY)}` +
      `&keywords=${encodeURIComponent(kw)}&offset=8&page=1`;
    const data = await fetchWithTimeout(url, 5000);
    if (data?.status === '1' && Array.isArray(data.pois) && data.pois.length > 0) {
      return data.pois
        .map((poi: any) => {
          const [lng, lat] = String(poi.location || '').split(',').map(Number);
          if (!lng || !lat) return null;
          return {
            id: String(poi.id),
            name: String(poi.name),
            address: `${poi.cityname || ''}${poi.adname || ''}${typeof poi.address === 'string' ? poi.address : ''}`,
            lng,
            lat,
          };
        })
        .filter(Boolean) as PlaceSuggestion[];
    }
  }

  // 2. 腾讯地图地点搜索 JSONP
  if (TMAP_KEY) {
    const tUrl =
      `https://apis.map.qq.com/ws/place/v1/suggestion?key=${encodeURIComponent(TMAP_KEY)}` +
      `&keyword=${encodeURIComponent(kw)}&page_size=8`;
    const tData = await fetchJsonp<any>(tUrl, 5000);
    if (tData?.status === 0 && Array.isArray(tData.data) && tData.data.length > 0) {
      return tData.data
        .map((item: any) => {
          const lat = Number(item.location?.lat);
          const lng = Number(item.location?.lng);
          if (!lat || !lng) return null;
          return {
            id: String(item.id),
            name: String(item.title),
            address: String(item.address || `${item.province || ''}${item.city || ''}`),
            lng,
            lat,
          };
        })
        .filter(Boolean) as PlaceSuggestion[];
    }
  }

  return [];
}

/**
 * 生成高德地图步行导航链接
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

/**
 * 生成腾讯地图步行导航链接
 */
export function buildTencentWalkUrl(opts: {
  toLng: number;
  toLat: number;
  toName: string;
  fromLng?: number | null;
  fromLat?: number | null;
}): string {
  const params = new URLSearchParams();
  params.set('type', 'walk');
  if (opts.fromLng && opts.fromLat) {
    params.set('from', '我的位置');
    params.set('fromcoord', `${opts.fromLat},${opts.fromLng}`);
  }
  params.set('to', opts.toName || '目标厕所');
  params.set('tocoord', `${opts.toLat},${opts.toLng}`);
  params.set('referer', TMAP_KEY || 'zhizhaocesuo');
  return `https://apis.map.qq.com/uri/v1/routeplan?${params.toString()}`;
}
