// lib/amap-server.ts
// 纯后端高德 Web服务网关：
// 1. Key 100% 隐藏于服务端（支持多 Key 逗号分隔自动轮换与日限额熔断保护）
// 2. 全局 < 3 QPS 平滑限流队列（防止小红书突发并发触发 10021 报错）
// 3. 全站共享 SQLite 街区冷却缓存（默认 24 小时同街区 0 重复搜索消耗 + 并发请求合并）
// 4. 服务端共享步行测距 / 路线规划 / 搜索 / 逆地理 / IP 缓存

import {
  getAreaSyncCell,
  makeSharedAreaCellKey,
  recordAreaSyncCell,
} from '@/lib/db';
import {
  AMAP_VENUE_TYPES_BATCH_1,
  AMAP_VENUE_TYPES_BATCH_2,
  classifyAndParseVenuePoi,
  type DiscoveredInferredVenue,
} from '@/lib/inferredVenues';
import { syncDiscoveredPoisToDb } from '@/lib/toiletSync';
import type { MapBounds } from '@/types';

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

export interface WalkingDistanceEntry {
  id: string;
  distance: number; // 最短可行步行路线距离（米）
  duration: number; // 预计步行耗时（秒）
}

export interface ShortestWalkingRouteResult {
  distance: number;
  duration: number;
  polyline: [number, number][];
}

const EXCLUDE_NON_TOILET_RE =
  /疏通|维修|洁具|卫浴|建材|五金|专卖|批发|安装|清洁|家政|陶瓷|马桶盖/;

const RESTROOM_TYPES = '200300|200301|200302|200303|200304';
const RESTROOM_KEYWORDS = '厕所|公共厕所|洗手间|卫生间|公厕';

// 默认全站共享街区冷却周期：24 小时（可通过环境变量 AMAP_SYNC_COOLDOWN_HOURS 调整）
function getAreaCooldownMs(): number {
  const env = process.env as Record<string, string | undefined>;
  const hours = Number(env['AMAP_SYNC_COOLDOWN_HOURS'] || '24');
  const validHours = Number.isFinite(hours) && hours >= 0.25 ? hours : 24;
  return Math.round(validHours * 3600 * 1000);
}

// 普通访客手动点「刷新」的最小防刷间隔：15 分钟（管理员不受此限）
const MIN_PUBLIC_FORCE_INTERVAL_MS = 15 * 60 * 1000;

// ==================== 1. 服务端私有 Key 池与日配额熔断保护 ====================

interface GlobalAmapState {
  exhaustedKeys: Map<string, number>; // key -> 恢复时间戳 (epoch ms)
  keyCursor: number;
  paceChain: Promise<void>;
  lastRequestAt: number;
  inflightAreaSyncs: Map<string, Promise<any>>;
  distanceCache: Map<string, { val: { distance: number; duration: number }; exp: number }>;
  routePlanCache: Map<string, { val: ShortestWalkingRouteResult; exp: number }>;
  regeoCache: Map<string, { val: string; exp: number }>;
  placeSearchCache: Map<string, { val: any[]; exp: number }>;
  ipLocCache: Map<string, { val: { lng: number; lat: number; city: string }; exp: number }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __zzcsAmapGateway: GlobalAmapState | undefined;
}

function getGatewayState(): GlobalAmapState {
  if (!globalThis.__zzcsAmapGateway) {
    globalThis.__zzcsAmapGateway = {
      exhaustedKeys: new Map(),
      keyCursor: 0,
      paceChain: Promise.resolve(),
      lastRequestAt: 0,
      inflightAreaSyncs: new Map(),
      distanceCache: new Map(),
      routePlanCache: new Map(),
      regeoCache: new Map(),
      placeSearchCache: new Map(),
      ipLocCache: new Map(),
    };
  }
  return globalThis.__zzcsAmapGateway;
}

function getNextBeijingMidnightMs(): number {
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const bjTomorrow = Date.UTC(
    bjNow.getUTCFullYear(),
    bjNow.getUTCMonth(),
    bjNow.getUTCDate() + 1,
    0,
    0,
    5
  );
  return bjTomorrow - 8 * 3600 * 1000;
}

function getServerKeyPool(): string[] {
  const env = process.env as Record<string, string | undefined>;
  const raw =
    env['AMAP_SERVER_KEY'] ||
    env['AMAP_API_KEY'] ||
    env['NEXT_PUBLIC_AMAP_KEY'] ||
    '';
  return raw
    .split(/[,;\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function pickAvailableAmapKey(): string | null {
  const pool = getServerKeyPool();
  if (pool.length === 0) return null;

  const state = getGatewayState();
  const now = Date.now();

  for (let i = 0; i < pool.length; i++) {
    const idx = (state.keyCursor + i) % pool.length;
    const candidate = pool[idx];
    const blockedUntil = state.exhaustedKeys.get(candidate) || 0;
    if (blockedUntil > now) continue;
    if (blockedUntil > 0) state.exhaustedKeys.delete(candidate);
    state.keyCursor = (idx + 1) % pool.length;
    return candidate;
  }
  return null;
}

function markKeyDailyExhausted(key: string) {
  const state = getGatewayState();
  state.exhaustedKeys.set(key, getNextBeijingMidnightMs());
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * 全局平滑限流槽：确保对高德接口的请求间隔 >= 360ms（约 2.7 QPS，严格低于个人开发者 3 QPS 上限）
 */
async function acquireQpsSlot(): Promise<void> {
  const state = getGatewayState();
  const minInterval = Math.max(
    120,
    Math.floor(360 / Math.max(1, getServerKeyPool().length))
  );

  let release!: () => void;
  const prev = state.paceChain;
  state.paceChain = new Promise<void>((r) => {
    release = r;
  });

  await prev;
  const now = Date.now();
  const waitMs = state.lastRequestAt + minInterval - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  state.lastRequestAt = Date.now();
  release();
}

async function callAmapEndpoint(
  buildUrl: (key: string) => string,
  timeoutMs = 4000
): Promise<any | null> {
  const maxAttempts = Math.max(2, getServerKeyPool().length + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = pickAvailableAmapKey();
    if (!key) return null;

    await acquireQpsSlot();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(buildUrl(key), {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const data = await res.json();

      // 10021 = QPS 并发超限 -> 退避 480ms 重试
      if (data?.infocode === '10021') {
        clearTimeout(timer);
        await sleep(480);
        continue;
      }

      // 10003 / 10044 = 当日配额耗尽 -> 熔断当前 Key 并自动尝试备用 Key
      if (data?.infocode === '10003' || data?.infocode === '10044') {
        markKeyDailyExhausted(key);
        clearTimeout(timer);
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

function setBoundedCache<V>(
  map: Map<string, { val: V; exp: number }>,
  key: string,
  val: V,
  ttlMs: number,
  maxSize: number
) {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, { val, exp: Date.now() + ttlMs });
}

function getBoundedCache<V>(
  map: Map<string, { val: V; exp: number }>,
  key: string
): V | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.val;
}

// ==================== 2. POI 解析与多波检索 ====================

export function normalizeAmapPois(rawPois: any[]): ParsedAmapPOI[] {
  if (!Array.isArray(rawPois)) return [];
  const list: ParsedAmapPOI[] = [];

  for (const poi of rawPois) {
    const name = String(poi?.name || '').trim();
    if (!name || EXCLUDE_NON_TOILET_RE.test(name)) continue;

    const typecode = String(poi?.typecode || '');
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

export async function searchAroundToiletsServer(opts: {
  lng: number;
  lat: number;
  radius?: number;
  bounds?: MapBounds | null;
}): Promise<ParsedAmapPOI[]> {
  if (!pickAvailableAmapKey() && getServerKeyPool().length === 0) return [];

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

  // 第 1 波：分类检索第 1 页 + 关键词检索第 1 页（通过全局限流槽自动排队，绝不超 QPS）
  const [typeP1, kwP1] = await Promise.all([
    callAmapEndpoint(
      (key) =>
        `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
        `&location=${loc}&radius=${radius}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
        `&sortrule=distance&offset=25&page=1&extensions=all`
    ),
    callAmapEndpoint(
      (key) =>
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

  // 第 2 波：补充第 2 页 + 视野矩形分类覆盖
  const wave2Tasks: Promise<any>[] = [];
  if (c1 >= 20) {
    wave2Tasks.push(
      callAmapEndpoint(
        (key) =>
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
      callAmapEndpoint(
        (key) =>
          `https://restapi.amap.com/v3/place/polygon?key=${encodeURIComponent(key)}` +
          `&polygon=${encodeURIComponent(polygon)}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
          `&offset=25&page=1&extensions=all`
      )
    );
  } else if (c2 >= 20) {
    wave2Tasks.push(
      callAmapEndpoint(
        (key) =>
          `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
          `&location=${loc}&radius=${radius}&keywords=${encodeURIComponent(RESTROOM_KEYWORDS)}` +
          `&sortrule=distance&offset=25&page=2&extensions=all`
      )
    );
  }

  let cTypeP2 = 0;
  if (wave2Tasks.length > 0) {
    const wave2Res = await Promise.all(wave2Tasks);
    if (c1 >= 20 && Array.isArray(wave2Res[0]?.pois)) {
      cTypeP2 = wave2Res[0].pois.length;
    }
    for (const r of wave2Res) addBatch(r);
  }

  // 第 3 波：若公厕密集或存在矩形视野，补齐视野内商场/医院/地铁洗手间关键词
  const wave3Tasks: Promise<any>[] = [];
  if (cTypeP2 >= 20) {
    wave3Tasks.push(
      callAmapEndpoint(
        (key) =>
          `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
          `&location=${loc}&radius=${radius}&types=${encodeURIComponent(RESTROOM_TYPES)}` +
          `&sortrule=distance&offset=25&page=3&extensions=all`
      )
    );
  }
  if (opts.bounds) {
    const b = opts.bounds;
    const polygon = `${b.minLng.toFixed(6)},${b.maxLat.toFixed(6)}|${b.maxLng.toFixed(6)},${b.minLat.toFixed(6)}`;
    wave3Tasks.push(
      callAmapEndpoint(
        (key) =>
          `https://restapi.amap.com/v3/place/polygon?key=${encodeURIComponent(key)}` +
          `&polygon=${encodeURIComponent(polygon)}&keywords=${encodeURIComponent('厕所|卫生间|洗手间')}` +
          `&offset=25&page=1&extensions=all`
      )
    );
  }

  if (wave3Tasks.length > 0) {
    const wave3Res = await Promise.all(wave3Tasks);
    for (const r of wave3Res) addBatch(r);
  }

  return Array.from(merged.values());
}

export async function searchInferredVenuesServer(opts: {
  lng: number;
  lat: number;
  radius?: number;
}): Promise<DiscoveredInferredVenue[]> {
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

  const [res1, res2] = await Promise.all([
    callAmapEndpoint(
      (key) =>
        `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
        `&location=${loc}&radius=${radius}&types=${encodeURIComponent(AMAP_VENUE_TYPES_BATCH_1)}` +
        `&sortrule=distance&offset=25&page=1&extensions=base`
    ),
    callAmapEndpoint(
      (key) =>
        `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
        `&location=${loc}&radius=${radius}&types=${encodeURIComponent(AMAP_VENUE_TYPES_BATCH_2)}` +
        `&sortrule=distance&offset=25&page=1&extensions=base`
    ),
  ]);

  collect(res1);
  collect(res2);

  return Array.from(merged.values());
}

// ==================== 3. 全站共享区域冷却同步入口（省 90%+ 配额） ====================

export interface SharedAreaSyncResult {
  cached: boolean;
  cooldownRemainingSec: number;
  poiCount: number;
  synced: number;
  updated: number;
  retired: number;
  syncedInferred: number;
}

export async function syncAreaToiletsSharedServer(opts: {
  lng: number;
  lat: number;
  radius?: number;
  bounds?: MapBounds | null;
  force?: boolean;
  isAdmin?: boolean;
}): Promise<SharedAreaSyncResult> {
  const radius = Math.min(Math.max(opts.radius || 3000, 1500), 8000);
  const cellKey = makeSharedAreaCellKey('AROUND', opts.lng, opts.lat);
  const cooldownMs = getAreaCooldownMs();
  const now = Date.now();

  const existingCell = getAreaSyncCell(cellKey);
  if (existingCell) {
    const elapsed = now - existingCell.syncedAt;
    const allowForceBypass =
      Boolean(opts.force) &&
      (Boolean(opts.isAdmin) || elapsed >= MIN_PUBLIC_FORCE_INTERVAL_MS);

    if (!allowForceBypass && elapsed < cooldownMs) {
      return {
        cached: true,
        cooldownRemainingSec: Math.max(
          1,
          Math.round((cooldownMs - elapsed) / 1000)
        ),
        poiCount: existingCell.poiCount,
        synced: 0,
        updated: 0,
        retired: 0,
        syncedInferred: 0,
      };
    }
  }

  // 并发合并：同一街区同一时刻若有多个访客进入，共享同一个进行中的高德扫描 Promise
  const state = getGatewayState();
  const inflight = state.inflightAreaSyncs.get(cellKey);
  if (inflight && !opts.force) {
    return inflight;
  }

  const task = (async (): Promise<SharedAreaSyncResult> => {
    try {
      const pois = await searchAroundToiletsServer({
        lng: opts.lng,
        lat: opts.lat,
        radius,
        bounds: opts.bounds,
      });

      // 仅当高德成功返回结果（非配额耗尽/断网失败）时才写入冷却时间戳，避免断网锁死网格
      if (pois.length > 0) {
        const syncStats = syncDiscoveredPoisToDb({
          pois,
          fullScan: true,
          scanCenter: {
            lng: opts.lng,
            lat: opts.lat,
            force: Boolean(opts.force),
          },
        });

        recordAreaSyncCell({
          cellKey,
          kind: 'AROUND',
          lng: opts.lng,
          lat: opts.lat,
          radius,
          poiCount: pois.length,
        });

        return {
          cached: false,
          cooldownRemainingSec: Math.round(cooldownMs / 1000),
          poiCount: pois.length,
          ...syncStats,
        };
      }

      return {
        cached: false,
        cooldownRemainingSec: 0,
        poiCount: 0,
        synced: 0,
        updated: 0,
        retired: 0,
        syncedInferred: 0,
      };
    } finally {
      state.inflightAreaSyncs.delete(cellKey);
    }
  })();

  state.inflightAreaSyncs.set(cellKey, task);
  return task;
}

export async function syncInferredVenuesSharedServer(opts: {
  lng: number;
  lat: number;
  radius?: number;
  force?: boolean;
  isAdmin?: boolean;
}): Promise<SharedAreaSyncResult> {
  const radius = Math.min(Math.max(opts.radius || 2500, 1500), 5000);
  const cellKey = makeSharedAreaCellKey('INFERRED', opts.lng, opts.lat);
  const cooldownMs = getAreaCooldownMs();
  const now = Date.now();

  const existingCell = getAreaSyncCell(cellKey);
  if (existingCell) {
    const elapsed = now - existingCell.syncedAt;
    const allowForceBypass =
      Boolean(opts.force) &&
      (Boolean(opts.isAdmin) || elapsed >= MIN_PUBLIC_FORCE_INTERVAL_MS);

    if (!allowForceBypass && elapsed < cooldownMs) {
      return {
        cached: true,
        cooldownRemainingSec: Math.max(
          1,
          Math.round((cooldownMs - elapsed) / 1000)
        ),
        poiCount: existingCell.poiCount,
        synced: 0,
        updated: 0,
        retired: 0,
        syncedInferred: 0,
      };
    }
  }

  const state = getGatewayState();
  const inflight = state.inflightAreaSyncs.get(cellKey);
  if (inflight && !opts.force) {
    return inflight;
  }

  const task = (async (): Promise<SharedAreaSyncResult> => {
    try {
      const venues = await searchInferredVenuesServer({
        lng: opts.lng,
        lat: opts.lat,
        radius,
      });

      if (venues.length > 0) {
        const syncStats = syncDiscoveredPoisToDb({
          inferredVenues: venues,
        });

        recordAreaSyncCell({
          cellKey,
          kind: 'INFERRED',
          lng: opts.lng,
          lat: opts.lat,
          radius,
          poiCount: venues.length,
        });

        return {
          cached: false,
          cooldownRemainingSec: Math.round(cooldownMs / 1000),
          poiCount: venues.length,
          ...syncStats,
        };
      }

      return {
        cached: false,
        cooldownRemainingSec: 0,
        poiCount: 0,
        synced: 0,
        updated: 0,
        retired: 0,
        syncedInferred: 0,
      };
    } finally {
      state.inflightAreaSyncs.delete(cellKey);
    }
  })();

  state.inflightAreaSyncs.set(cellKey, task);
  return task;
}

// ==================== 4. 逆地理、IP定位、地点搜索与步行测距（全部带服务端共享缓存） ====================

export async function reverseGeocodeServer(
  lng: number,
  lat: number
): Promise<string> {
  const state = getGatewayState();
  const cacheKey = `${Math.round(lng * 4000)}_${Math.round(lat * 4000)}`;
  const cached = getBoundedCache(state.regeoCache, cacheKey);
  if (cached) return cached;

  const data = await callAmapEndpoint(
    (key) =>
      `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}` +
      `&location=${lng.toFixed(6)},${lat.toFixed(6)}&extensions=base`,
    3000
  );
  if (
    data?.status === '1' &&
    typeof data.regeocode?.formatted_address === 'string' &&
    data.regeocode.formatted_address
  ) {
    const addr = data.regeocode.formatted_address;
    setBoundedCache(state.regeoCache, cacheKey, addr, 24 * 3600 * 1000, 3000);
    return addr;
  }
  return '';
}

export async function locateByIpServer(clientIp?: string | null): Promise<{
  lng: number;
  lat: number;
  city: string;
} | null> {
  const state = getGatewayState();
  const cleanIp = (clientIp || '').split(',')[0].trim();
  const usableIp =
    cleanIp &&
    cleanIp !== '127.0.0.1' &&
    cleanIp !== '::1' &&
    !cleanIp.startsWith('10.') &&
    !cleanIp.startsWith('192.168.') &&
    !cleanIp.startsWith('172.16.')
      ? cleanIp
      : '';

  const cacheKey = usableIp || '__server_default_ip__';
  const cached = getBoundedCache(state.ipLocCache, cacheKey);
  if (cached) return cached;

  const data = await callAmapEndpoint((key) => {
    let url = `https://restapi.amap.com/v3/ip?key=${encodeURIComponent(key)}`;
    if (usableIp) url += `&ip=${encodeURIComponent(usableIp)}`;
    return url;
  }, 3000);

  if (
    data?.status === '1' &&
    typeof data.rectangle === 'string' &&
    data.rectangle.includes(';')
  ) {
    const [p1, p2] = data.rectangle.split(';');
    const [lng1, lat1] = (p1 || '').split(',').map(Number);
    const [lng2, lat2] = (p2 || '').split(',').map(Number);
    if (
      Number.isFinite(lng1) &&
      Number.isFinite(lat1) &&
      Number.isFinite(lng2) &&
      Number.isFinite(lat2)
    ) {
      const loc = {
        lng: Number(((lng1 + lng2) / 2).toFixed(6)),
        lat: Number(((lat1 + lat2) / 2).toFixed(6)),
        city:
          (typeof data.city === 'string' && data.city) ||
          (typeof data.province === 'string' && data.province) ||
          '',
      };
      setBoundedCache(state.ipLocCache, cacheKey, loc, 6 * 3600 * 1000, 2000);
      return loc;
    }
  }
  return null;
}

export async function searchPlaceServer(
  keyword: string,
  lng?: number,
  lat?: number
) {
  const kw = keyword.trim();
  if (!kw) return [];

  const state = getGatewayState();
  const nearBucket =
    Number.isFinite(lng) && Number.isFinite(lat)
      ? `${Math.round(Number(lng) * 50)}_${Math.round(Number(lat) * 50)}`
      : 'global';
  const cacheKey = `${kw.toLowerCase()}::${nearBucket}`;
  const cached = getBoundedCache(state.placeSearchCache, cacheKey);
  if (cached) return cached;

  const data = await callAmapEndpoint((key) => {
    let url =
      `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(key)}` +
      `&keywords=${encodeURIComponent(kw)}&offset=10&page=1`;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      url += `&location=${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`;
    }
    return url;
  }, 4000);

  if (data?.status === '1' && Array.isArray(data.pois)) {
    const places = data.pois
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
    setBoundedCache(
      state.placeSearchCache,
      cacheKey,
      places,
      2 * 3600 * 1000,
      1500
    );
    return places;
  }
  return [];
}

function makeServerRouteBucket(lng: number, lat: number): string {
  // ~35米共享起点网格：同一地铁口/商场门口的不同用户直接命中服务端测距缓存
  return `${Math.round(lng * 3000)}_${Math.round(lat * 3000)}`;
}

/**
 * 服务端批量测算最短步行规划距离（带全站 ~35m 起点网格缓存，仅向高德请求未缓存的差量点位）
 */
export async function batchWalkingDistanceServer(opts: {
  userLng: number;
  userLat: number;
  targets: { id: string; lng: number; lat: number }[];
}): Promise<WalkingDistanceEntry[]> {
  if (!opts.targets.length) return [];

  const state = getGatewayState();
  const originBucket = makeServerRouteBucket(opts.userLng, opts.userLat);
  const out: WalkingDistanceEntry[] = [];
  const uncached: { id: string; lng: number; lat: number }[] = [];

  for (const t of opts.targets.slice(0, 100)) {
    const cKey = `${originBucket}::${t.id}`;
    const hit = getBoundedCache(state.distanceCache, cKey);
    if (hit) {
      out.push({ id: t.id, distance: hit.distance, duration: hit.duration });
    } else {
      uncached.push(t);
    }
  }

  if (uncached.length === 0) {
    return out;
  }

  const origins = uncached
    .map((t) => `${t.lng.toFixed(6)},${t.lat.toFixed(6)}`)
    .join('|');
  const dest = `${opts.userLng.toFixed(6)},${opts.userLat.toFixed(6)}`;

  const data = await callAmapEndpoint(
    (key) =>
      `https://restapi.amap.com/v3/distance?key=${encodeURIComponent(key)}` +
      `&origins=${encodeURIComponent(origins)}&destination=${encodeURIComponent(dest)}&type=3`,
    4500
  );

  if (data?.status === '1' && Array.isArray(data.results)) {
    for (const r of data.results) {
      const idx = Number(r?.origin_id) - 1;
      const dist = Number(r?.distance);
      const dur = Number(r?.duration);
      if (
        idx >= 0 &&
        idx < uncached.length &&
        Number.isFinite(dist) &&
        dist >= 0 &&
        !r?.info
      ) {
        const target = uncached[idx];
        const entry = {
          distance: Math.round(dist),
          duration:
            Number.isFinite(dur) && dur > 0
              ? Math.round(dur)
              : Math.max(60, Math.round(dist / 1.25)),
        };
        setBoundedCache(
          state.distanceCache,
          `${originBucket}::${target.id}`,
          entry,
          12 * 3600 * 1000,
          12000
        );
        out.push({ id: target.id, ...entry });
      }
    }
  }

  return out;
}

/**
 * 服务端单点最短可行步行路线规划（带全站共享缓存）
 */
export async function planShortestWalkingRouteServer(opts: {
  fromLng: number;
  fromLat: number;
  toLng: number;
  toLat: number;
}): Promise<ShortestWalkingRouteResult | null> {
  const state = getGatewayState();
  const routeKey = `${makeServerRouteBucket(opts.fromLng, opts.fromLat)}->${opts.toLng.toFixed(5)},${opts.toLat.toFixed(5)}`;
  const cached = getBoundedCache(state.routePlanCache, routeKey);
  if (cached) return cached;

  const origin = `${opts.fromLng.toFixed(6)},${opts.fromLat.toFixed(6)}`;
  const destination = `${opts.toLng.toFixed(6)},${opts.toLat.toFixed(6)}`;

  const data = await callAmapEndpoint(
    (key) =>
      `https://restapi.amap.com/v3/direction/walking?key=${encodeURIComponent(key)}` +
      `&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`,
    4500
  );

  const paths = data?.route?.paths;
  if (data?.status !== '1' || !Array.isArray(paths) || paths.length === 0) {
    return null;
  }

  let bestPath = paths[0];
  for (const p of paths) {
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
      const rawPoly = typeof step?.polyline === 'string' ? step.polyline : '';
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

  const result: ShortestWalkingRouteResult = { distance, duration, polyline };
  setBoundedCache(
    state.routePlanCache,
    routeKey,
    result,
    24 * 3600 * 1000,
    3000
  );
  return result;
}
