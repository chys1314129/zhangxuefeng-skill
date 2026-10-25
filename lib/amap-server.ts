// lib/amap-server.ts
// 服务端高德 Web服务 API 封装（动态读取运行时环境变量、带 QPS 退避重试与无外网超时保护）

import type { MapBounds } from '@/types';
import {
  AMAP_VENUE_TYPES_BATCH_1,
  AMAP_VENUE_TYPES_BATCH_2,
  classifyAndParseVenuePoi,
  type DiscoveredInferredVenue,
} from '@/lib/inferredVenues';

export interface ParsedAmapPOI {
  externalId: string;
  name: string;
  lng: number;
  lat: number;
  address: string;
  floor: string | null;
  hasAccessible: boolean | null;
  provider: 'amap';
}

const EXCLUDE_NON_TOILET_RE =
  /疏通|维修|洁具|卫浴|建材|五金|专卖|批发|安装|清洁|家政|陶瓷|马桶盖/;

const RESTROOM_TYPES = '200300|200301|200302|200303|200304';
const RESTROOM_KEYWORDS = '厕所|公共厕所|洗手间|卫生间|公厕';

function getServerAmapKey(): string {
  // 使用中括号读取，防止 Next.js 构建期将未配置的环境变量静态内联为空字符串
  const env = process.env as Record<string, string | undefined>;
  return (env['AMAP_SERVER_KEY'] || env['NEXT_PUBLIC_AMAP_KEY'] || '').trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAmapJson(url: string, timeoutMs = 3500): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const data = await res.json();
      // 10021 = CUQPS_HAS_EXCEEDED_THE_LIMIT（个人开发者 Key 并发超限），退避重试一次
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

export function normalizeAmapPois(rawPois: any[]): ParsedAmapPOI[] {
  if (!Array.isArray(rawPois)) return [];
  const list: ParsedAmapPOI[] = [];

  for (const poi of rawPois) {
    const name = String(poi?.name || '').trim();
    if (!name || EXCLUDE_NON_TOILET_RE.test(name)) continue;

    const typecode = String(poi?.typecode || '');
    // 排除生活维修(0712xx)与家居建材市场(0606xx)等同名干扰项
    if (typecode.startsWith('0606') || typecode.startsWith('0712')) {
      continue;
    }

    const [pLng, pLat] = String(poi?.location || '').split(',').map(Number);
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

    const isAccessible =
      typecode.includes('200303') ||
      /无障碍|第三卫生间|残障|残疾人/.test(name)
        ? true
        : null;

    list.push({
      externalId: `amap_${poi.id}`,
      name,
      lng: pLng,
      lat: pLat,
      address,
      floor,
      hasAccessible: isAccessible,
      provider: 'amap',
    });
  }

  return list;
}

export async function reverseGeocodeServer(
  lng: number,
  lat: number
): Promise<string> {
  const key = getServerAmapKey();
  if (!key) return '';
  const url =
    `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}` +
    `&location=${lng.toFixed(6)},${lat.toFixed(6)}&extensions=base`;
  const data = await fetchAmapJson(url, 2500);
  if (data?.status === '1' && typeof data.regeocode?.formatted_address === 'string') {
    return data.regeocode.formatted_address;
  }
  return '';
}

export async function locateByIpServer(clientIp?: string | null): Promise<{
  lng: number;
  lat: number;
  city: string;
} | null> {
  const key = getServerAmapKey();
  if (!key) return null;

  let url = `https://restapi.amap.com/v3/ip?key=${encodeURIComponent(key)}`;
  const cleanIp = (clientIp || '').split(',')[0].trim();
  if (
    cleanIp &&
    cleanIp !== '127.0.0.1' &&
    cleanIp !== '::1' &&
    !cleanIp.startsWith('10.') &&
    !cleanIp.startsWith('192.168.') &&
    !cleanIp.startsWith('172.16.')
  ) {
    url += `&ip=${encodeURIComponent(cleanIp)}`;
  }

  const data = await fetchAmapJson(url, 2500);
  if (data?.status === '1' && typeof data.rectangle === 'string' && data.rectangle.includes(';')) {
    const [p1, p2] = data.rectangle.split(';');
    const [lng1, lat1] = (p1 || '').split(',').map(Number);
    const [lng2, lat2] = (p2 || '').split(',').map(Number);
    if (
      Number.isFinite(lng1) &&
      Number.isFinite(lat1) &&
      Number.isFinite(lng2) &&
      Number.isFinite(lat2)
    ) {
      return {
        lng: Number(((lng1 + lng2) / 2).toFixed(6)),
        lat: Number(((lat1 + lat2) / 2).toFixed(6)),
        city:
          (typeof data.city === 'string' && data.city) ||
          (typeof data.province === 'string' && data.province) ||
          '',
      };
    }
  }
  return null;
}

export async function searchAroundToiletsServer(opts: {
  lng: number;
  lat: number;
  radius?: number;
  bounds?: MapBounds | null;
}): Promise<ParsedAmapPOI[]> {
  const key = getServerAmapKey();
  if (!key) return [];

  const radius = Math.min(Math.max(opts.radius || 3000, 300), 10000);
  const loc = `${opts.lng.toFixed(6)},${opts.lat.toFixed(6)}`;
  const merged = new Map<string, ParsedAmapPOI>();

  const addBatch = (data: any) => {
    if (data?.status === '1' && Array.isArray(data.pois)) {
      for (const item of normalizeAmapPois(data.pois)) {
        if (!merged.has(item.externalId)) {
          merged.set(item.externalId, item);
        }
      }
      return data.pois.length;
    }
    return 0;
  };

  // 第 1 波（2 并发，遵循 3 QPS）：分类检索第 1 页 + 关键词检索第 1 页
  const [typeP1, kwP1] = await Promise.all([
    fetchAmapJson(
      `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
        `&location=${loc}&radius=${radius}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
        `&sortrule=distance&offset=25&page=1&extensions=all`
    ),
    fetchAmapJson(
      `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
        `&location=${loc}&radius=${radius}&keywords=${encodeURIComponent(RESTROOM_KEYWORDS)}` +
        `&sortrule=distance&offset=25&page=1&extensions=all`
    ),
  ]);

  const c1 = addBatch(typeP1);
  const c2 = addBatch(kwP1);
  if (c1 === 0 && c2 === 0) {
    return [];
  }

  // 第 2 波：补充第 2 页 + 视野矩形覆盖（防止周边远处区域空白）
  await sleep(450);
  const wave2Tasks: Promise<any>[] = [];
  if (c1 >= 20) {
    wave2Tasks.push(
      fetchAmapJson(
        `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
          `&location=${loc}&radius=${radius}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
          `&sortrule=distance&offset=25&page=2&extensions=all`
      )
    );
  }
  if (opts.bounds) {
    const b = opts.bounds;
    const polygon = `${b.minLng.toFixed(6)},${b.maxLat.toFixed(6)}|${b.maxLng.toFixed(6)},${b.minLat.toFixed(6)}`;
    wave2Tasks.push(
      fetchAmapJson(
        `https://restapi.amap.com/v3/place/polygon?key=${encodeURIComponent(key)}` +
          `&polygon=${encodeURIComponent(polygon)}&keywords=${encodeURIComponent('厕所|卫生间|洗手间')}` +
          `&offset=25&page=1&extensions=all`
      )
    );
  } else if (c2 >= 20) {
    wave2Tasks.push(
      fetchAmapJson(
        `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
          `&location=${loc}&radius=${radius}&keywords=${encodeURIComponent(RESTROOM_KEYWORDS)}` +
          `&sortrule=distance&offset=25&page=2&extensions=all`
      )
    );
  }

  if (wave2Tasks.length > 0) {
    const wave2Res = await Promise.all(wave2Tasks);
    for (const r of wave2Res) addBatch(r);
  }

  return Array.from(merged.values());
}

export async function searchPlaceServer(
  keyword: string,
  lng?: number,
  lat?: number
) {
  const key = getServerAmapKey();
  const kw = keyword.trim();
  if (!key || !kw) return [];

  let url =
    `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(key)}` +
    `&keywords=${encodeURIComponent(kw)}&offset=10&page=1`;
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    url += `&location=${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`;
  }

  const data = await fetchAmapJson(url, 3500);
  if (data?.status === '1' && Array.isArray(data.pois)) {
    return data.pois
      .map((poi: any) => {
        const [pLng, pLat] = String(poi?.location || '').split(',').map(Number);
        if (!pLng || !pLat) return null;
        return {
          id: String(poi.id),
          name: String(poi.name),
          address: `${poi.cityname || ''}${poi.adname || ''}${typeof poi.address === 'string' ? poi.address : ''}`,
          lng: pLng,
          lat: pLat,
        };
      })
      .filter(Boolean);
  }
  return [];
}

export async function searchInferredVenuesServer(opts: {
  lng: number;
  lat: number;
  radius?: number;
}): Promise<DiscoveredInferredVenue[]> {
  const key = getServerAmapKey();
  if (!key) return [];

  const radius = Math.min(Math.max(opts.radius || 2500, 400), 8000);
  const loc = `${opts.lng.toFixed(6)},${opts.lat.toFixed(6)}`;
  const merged = new Map<string, DiscoveredInferredVenue>();

  const collect = (data: any) => {
    if (data?.status === '1' && Array.isArray(data.pois)) {
      for (const raw of data.pois) {
        const parsed = classifyAndParseVenuePoi(raw);
        if (parsed && !merged.has(parsed.externalId)) {
          merged.set(parsed.externalId, parsed);
        }
      }
    }
  };

  // 2 并发请求覆盖全部 8 类场所（严格低于 3 QPS 限额）
  const [res1, res2] = await Promise.all([
    fetchAmapJson(
      `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
        `&location=${loc}&radius=${radius}&types=${encodeURIComponent(AMAP_VENUE_TYPES_BATCH_1)}` +
        `&sortrule=distance&offset=25&page=1&extensions=base`
    ),
    fetchAmapJson(
      `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
        `&location=${loc}&radius=${radius}&types=${encodeURIComponent(AMAP_VENUE_TYPES_BATCH_2)}` +
        `&sortrule=distance&offset=25&page=1&extensions=base`
    ),
  ]);

  collect(res1);
  collect(res2);

  return Array.from(merged.values());
}

