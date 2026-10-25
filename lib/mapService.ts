// lib/mapService.ts
// 高德地图服务层（多维分类+关键词+视野矩形全覆盖公厕检索、QPS 保护、JS SDK / 服务端双回退、逆地理编码、一键高德步行导航）

import type { MapBounds } from '@/types';

export interface DiscoveredPOI {
  externalId: string;
  name: string;
  lng: number;
  lat: number;
  address: string;
  floor?: string | null;
  hasAccessible?: boolean | null;
  provider: 'amap';
}

export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
}

const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY || '';
const AMAP_SECURITY_CODE = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || '';

const RESTROOM_TYPES = '200300|200301|200302|200303|200304';
const RESTROOM_KEYWORDS = '厕所|公共厕所|洗手间|卫生间|公厕';
const EXCLUDE_NON_TOILET_RE =
  /疏通|维修|洁具|卫浴|建材|五金|专卖|批发|安装|清洁|家政|陶瓷|马桶盖/;

let amapSdkPromise: Promise<any | null> | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAmapRest(url: string, timeoutMs = 5000): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      // 10021 = QPS 超限，自动等待 520ms 重试一次，防止漏页
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

function parseAmapPoiList(rawPois: any[]): DiscoveredPOI[] {
  if (!Array.isArray(rawPois)) return [];
  const items: DiscoveredPOI[] = [];

  for (const poi of rawPois) {
    const name = String(poi?.name || '').trim();
    if (!name || EXCLUDE_NON_TOILET_RE.test(name)) continue;

    const typecode = String(poi?.typecode || '');
    if (typecode.startsWith('0606') || typecode.startsWith('0712')) {
      continue;
    }

    let pLng = 0;
    let pLat = 0;
    if (typeof poi?.location === 'string') {
      const parts = poi.location.split(',').map(Number);
      pLng = parts[0];
      pLat = parts[1];
    } else if (poi?.location) {
      pLng = Number(poi.location.lng ?? poi.location.getLng?.());
      pLat = Number(poi.location.lat ?? poi.location.getLat?.());
    }
    if (!Number.isFinite(pLng) || !Number.isFinite(pLat) || !pLng || !pLat) {
      continue;
    }

    const rawAddr = typeof poi?.address === 'string' ? poi.address.trim() : '';
    const district = [
      typeof poi?.cityname === 'string' ? poi.cityname : '',
      typeof poi?.adname === 'string' ? poi.adname : '',
    ]
      .filter(Boolean)
      .join('');
    const address =
      rawAddr && district && !rawAddr.startsWith(district)
        ? `${district}${rawAddr}`
        : rawAddr || district;

    let floor: string | null = null;
    const rawFloor =
      poi?.indoor_data?.truefloor ?? poi?.indoor_data?.floor ?? null;
    if (typeof rawFloor === 'string' && rawFloor.trim()) {
      floor = rawFloor.trim().slice(0, 15);
    } else if (typeof rawFloor === 'number' && Number.isFinite(rawFloor)) {
      floor = rawFloor > 0 ? `${rawFloor}F` : `B${Math.abs(rawFloor)}`;
    }

    const hasAccessible =
      typecode.includes('200303') ||
      /无障碍|第三卫生间|残障|残疾人/.test(name)
        ? true
        : null;

    items.push({
      externalId: `amap_${poi.id}`,
      name,
      lng: pLng,
      lat: pLat,
      address,
      floor,
      hasAccessible,
      provider: 'amap',
    });
  }

  return items;
}

async function ensureAmapJsSdk(): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if ((window as any).AMap?.PlaceSearch) return (window as any).AMap;
  if (!AMAP_KEY) return null;

  if (!amapSdkPromise) {
    amapSdkPromise = (async () => {
      try {
        if (AMAP_SECURITY_CODE) {
          (window as any)._AMapSecurityConfig = {
            securityJsCode: AMAP_SECURITY_CODE,
          };
        }
        const mod = await import('@amap/amap-jsapi-loader');
        const AMapLoader = mod.default || mod;
        return await AMapLoader.load({
          key: AMAP_KEY,
          version: '2.0',
          plugins: ['AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.Scale'],
        });
      } catch {
        amapSdkPromise = null;
        return null;
      }
    })();
  }
  return amapSdkPromise;
}

/**
 * 搜索周边与当前视野范围内的高德真实厕所 POI（支持分波渐进回调，兼顾首屏速度与全视野无死角覆盖）
 */
export async function searchNearbyToiletPOIsClient(
  lng: number,
  lat: number,
  radius = 3000,
  bounds?: MapBounds | null,
  onWave?: (wavePois: DiscoveredPOI[]) => void
): Promise<DiscoveredPOI[]> {
  if (typeof window === 'undefined') return [];

  const clampedRadius = Math.min(Math.max(radius, 300), 10000);
  const loc = `${lng.toFixed(6)},${lat.toFixed(6)}`;
  const seen = new Map<string, DiscoveredPOI>();

  const collect = (list: DiscoveredPOI[]): DiscoveredPOI[] => {
    const fresh: DiscoveredPOI[] = [];
    for (const item of list) {
      if (!seen.has(item.externalId)) {
        seen.set(item.externalId, item);
        fresh.push(item);
      }
    }
    return fresh;
  };

  let isJsApiKeyOnly = false;

  // 1. 优先使用高德 Web服务 REST API（分类检索 + 关键词检索 + 视野矩形多页拉取）
  if (AMAP_KEY) {
    const [typeP1, kwP1] = await Promise.all([
      fetchAmapRest(
        `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(AMAP_KEY)}` +
          `&location=${loc}&radius=${clampedRadius}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
          `&sortrule=distance&offset=25&page=1&extensions=all`
      ),
      fetchAmapRest(
        `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(AMAP_KEY)}` +
          `&location=${loc}&radius=${clampedRadius}&keywords=${encodeURIComponent(RESTROOM_KEYWORDS)}` +
          `&sortrule=distance&offset=25&page=1&extensions=all`
      ),
    ]);

    if (typeP1?.infocode === '10009' || kwP1?.infocode === '10009') {
      isJsApiKeyOnly = true;
    } else {
      const c1 =
        typeP1?.status === '1' && Array.isArray(typeP1.pois)
          ? typeP1.pois.length
          : 0;
      const c2 =
        kwP1?.status === '1' && Array.isArray(kwP1.pois)
          ? kwP1.pois.length
          : 0;

      const wave1Fresh = collect([
        ...parseAmapPoiList(typeP1?.pois || []),
        ...parseAmapPoiList(kwP1?.pois || []),
      ]);
      if (wave1Fresh.length > 0 && onWave) {
        onWave(wave1Fresh);
      }

      if (c1 > 0 || c2 > 0) {
        // 第 2 波（间隔 460ms 保护 3 QPS）：拉取距离第 2 页 + 视野矩形分类覆盖
        await sleep(460);
        const wave2Promises: Promise<any>[] = [];
        if (c1 >= 20) {
          wave2Promises.push(
            fetchAmapRest(
              `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(AMAP_KEY)}` +
                `&location=${loc}&radius=${clampedRadius}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
                `&sortrule=distance&offset=25&page=2&extensions=all`
            )
          );
        }
        if (bounds) {
          const polygon = `${bounds.minLng.toFixed(6)},${bounds.maxLat.toFixed(6)}|${bounds.maxLng.toFixed(6)},${bounds.minLat.toFixed(6)}`;
          wave2Promises.push(
            fetchAmapRest(
              `https://restapi.amap.com/v3/place/polygon?key=${encodeURIComponent(AMAP_KEY)}` +
                `&polygon=${encodeURIComponent(polygon)}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
                `&offset=25&page=1&extensions=all`
            )
          );
        } else if (c2 >= 20) {
          wave2Promises.push(
            fetchAmapRest(
              `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(AMAP_KEY)}` +
                `&location=${loc}&radius=${clampedRadius}&keywords=${encodeURIComponent(RESTROOM_KEYWORDS)}` +
                `&sortrule=distance&offset=25&page=2&extensions=all`
            )
          );
        }

        let cTypeP2 = 0;
        if (wave2Promises.length > 0) {
          const w2 = await Promise.all(wave2Promises);
          if (c1 >= 20 && Array.isArray(w2[0]?.pois)) {
            cTypeP2 = w2[0].pois.length;
          }
          const wave2Fresh = collect(
            w2.flatMap((res) => parseAmapPoiList(res?.pois || []))
          );
          if (wave2Fresh.length > 0 && onWave) {
            onWave(wave2Fresh);
          }
        }

        // 第 3 波：拉取距离第 3 页 + 视野矩形关键词（覆盖商场/超市/医院/地铁公厕）
        const wave3Promises: Promise<any>[] = [];
        if (cTypeP2 >= 20) {
          wave3Promises.push(
            fetchAmapRest(
              `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(AMAP_KEY)}` +
                `&location=${loc}&radius=${clampedRadius}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
                `&sortrule=distance&offset=25&page=3&extensions=all`
            )
          );
        }
        if (bounds) {
          const polygon = `${bounds.minLng.toFixed(6)},${bounds.maxLat.toFixed(6)}|${bounds.maxLng.toFixed(6)},${bounds.minLat.toFixed(6)}`;
          wave3Promises.push(
            fetchAmapRest(
              `https://restapi.amap.com/v3/place/polygon?key=${encodeURIComponent(AMAP_KEY)}` +
                `&polygon=${encodeURIComponent(polygon)}&keywords=${encodeURIComponent('厕所|卫生间|洗手间')}` +
                `&offset=25&page=1&extensions=all`
            )
          );
        }

        if (wave3Promises.length > 0) {
          await sleep(460);
          const w3 = await Promise.all(wave3Promises);
          const wave3Fresh = collect(
            w3.flatMap((res) => parseAmapPoiList(res?.pois || []))
          );
          if (wave3Fresh.length > 0 && onWave) {
            onWave(wave3Fresh);
          }
        }

        if (seen.size > 0) {
          return Array.from(seen.values());
        }
      }
    }
  }

  // 2. 若 Key 为高德 JS API Key，主动等待 JS SDK 加载完成后执行多页检索（消除早期挂载竞态）
  if (isJsApiKeyOnly || AMAP_KEY) {
    const AMapGlobal = await ensureAmapJsSdk();
    if (AMapGlobal?.PlaceSearch) {
      const searchPage = (
        opts: { type?: string; keyword?: string; pageIndex: number }
      ) =>
        new Promise<DiscoveredPOI[]>((resolve) => {
          try {
            const ps = new AMapGlobal.PlaceSearch({
              type: opts.type || '',
              pageSize: 25,
              pageIndex: opts.pageIndex,
              extensions: 'all',
            });
            const timer = setTimeout(() => resolve([]), 4500);
            ps.searchNearBy(
              opts.keyword || '',
              [lng, lat],
              clampedRadius,
              (status: string, result: any) => {
                clearTimeout(timer);
                if (status === 'complete' && result?.poiList?.pois) {
                  resolve(parseAmapPoiList(result.poiList.pois));
                } else {
                  resolve([]);
                }
              }
            );
          } catch {
            resolve([]);
          }
        });

      const [sdkType1, sdkKw1] = await Promise.all([
        searchPage({ type: RESTROOM_TYPES, pageIndex: 1 }),
        searchPage({ keyword: '厕所', pageIndex: 1 }),
      ]);
      const fresh1 = collect([...sdkType1, ...sdkKw1]);
      if (fresh1.length > 0 && onWave) onWave(fresh1);

      if (sdkType1.length >= 20 || sdkKw1.length >= 20) {
        const [sdkType2, sdkKw2] = await Promise.all([
          sdkType1.length >= 20
            ? searchPage({ type: RESTROOM_TYPES, pageIndex: 2 })
            : Promise.resolve([]),
          sdkKw1.length >= 20
            ? searchPage({ keyword: '厕所', pageIndex: 2 })
            : Promise.resolve([]),
        ]);
        const fresh2 = collect([...sdkType2, ...sdkKw2]);
        if (fresh2.length > 0 && onWave) onWave(fresh2);
      }

      if (seen.size > 0) {
        return Array.from(seen.values());
      }
    }
  }

  // 3. 服务端代理兜底（当生产环境仅在运行时配置了环境变量而未重新编译前端包时自动生效）
  try {
    const qs = new URLSearchParams({
      lng: lng.toFixed(6),
      lat: lat.toFixed(6),
      radius: String(clampedRadius),
    });
    if (bounds) {
      qs.set('minLng', bounds.minLng.toFixed(6));
      qs.set('minLat', bounds.minLat.toFixed(6));
      qs.set('maxLng', bounds.maxLng.toFixed(6));
      qs.set('maxLat', bounds.maxLat.toFixed(6));
    }
    const res = await fetch(`/api/v1/amap/around?${qs.toString()}`);
    if (res.ok) {
      const json = await res.json();
      const serverPois: DiscoveredPOI[] = Array.isArray(json?.data?.pois)
        ? json.data.pois
        : [];
      const fresh = collect(serverPois);
      if (fresh.length > 0 && onWave) onWave(fresh);
    }
  } catch {
    // ignore
  }

  return Array.from(seen.values());
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
    const data = await fetchAmapRest(url, 4000);
    if (
      data?.status === '1' &&
      typeof data.regeocode?.formatted_address === 'string' &&
      data.regeocode.formatted_address
    ) {
      return data.regeocode.formatted_address;
    }
  }

  // 2. 高德 JS SDK Geocoder
  const AMapGlobal = await ensureAmapJsSdk();
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

  // 3. 服务端逆地理编码兜底
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
 * 搜索地点 / 地标（优先按当前视野周边偏好排序，支持全国地标跳转）
 */
export async function searchPlaceClient(
  keyword: string,
  nearLng?: number,
  nearLat?: number
): Promise<PlaceSuggestion[]> {
  const kw = keyword.trim();
  if (!kw || typeof window === 'undefined') return [];

  if (AMAP_KEY) {
    let url =
      `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(AMAP_KEY)}` +
      `&keywords=${encodeURIComponent(kw)}&offset=10&page=1`;
    if (Number.isFinite(nearLng) && Number.isFinite(nearLat)) {
      url += `&location=${Number(nearLng).toFixed(6)},${Number(nearLat).toFixed(6)}`;
    }
    const data = await fetchAmapRest(url, 4500);
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

  // 高德 JS SDK PlaceSearch 回退
  const AMapGlobal = await ensureAmapJsSdk();
  if (AMapGlobal?.PlaceSearch) {
    const sdkList = await new Promise<PlaceSuggestion[]>((resolve) => {
      try {
        const ps = new AMapGlobal.PlaceSearch({ pageSize: 10, pageIndex: 1 });
        const timer = setTimeout(() => resolve([]), 4000);
        ps.search(kw, (status: string, result: any) => {
          clearTimeout(timer);
          if (status === 'complete' && result?.poiList?.pois) {
            const list = result.poiList.pois
              .map((poi: any) => {
                const lng = Number(poi.location?.lng ?? poi.location?.getLng?.());
                const lat = Number(poi.location?.lat ?? poi.location?.getLat?.());
                if (!lng || !lat) return null;
                return {
                  id: String(poi.id),
                  name: String(poi.name),
                  address: typeof poi.address === 'string' ? poi.address : '',
                  lng,
                  lat,
                };
              })
              .filter(Boolean);
            resolve(list);
          } else {
            resolve([]);
          }
        });
      } catch {
        resolve([]);
      }
    });
    if (sdkList.length > 0) return sdkList;
  }

  // 服务端代理回退
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
