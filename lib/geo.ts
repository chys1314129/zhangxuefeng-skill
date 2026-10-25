// lib/geo.ts
// 地理空间计算与 WGS84 <-> GCJ-02（火星坐标系）转换工具

const EARTH_RADIUS_M = 6371000;
const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;

function toRad(deg: number): number {
  return (deg * PI) / 180;
}

/**
 * 计算两点间球面距离（单位：米），精度与 PostGIS ST_Distance(geography) 一致
 */
export function haversineDistance(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_M * c);
}

/**
 * 计算指定半径（米）的经纬度包围盒，用于数据库索引快速初筛
 */
export function getBoundingBox(
  lng: number,
  lat: number,
  radiusMeters: number
) {
  const latDelta = (radiusMeters / EARTH_RADIUS_M) * (180 / PI);
  const cosLat = Math.max(0.01, Math.cos(toRad(lat)));
  const lngDelta = (radiusMeters / (EARTH_RADIUS_M * cosLat)) * (180 / PI);

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/**
 * 判断是否在大中华区范围（用于定位默认中心策略）
 */
export function isInGreaterChina(lng: number, lat: number): boolean {
  return lng >= 73.5 && lng <= 135.1 && lat >= 18.0 && lat <= 53.6;
}

function outOfMainlandChina(lng: number, lat: number): boolean {
  if (lng < 72.004 || lng > 137.8347) return true;
  if (lat < 0.8293 || lat > 55.8271) return true;
  // 香港、澳门、台湾通常无需加密偏移或偏移极小，此处保留标准判断
  return false;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * PI) +
      300.0 * Math.sin((x / 30.0) * PI)) *
      2.0) /
    3.0;
  return ret;
}

/**
 * 浏览器 GPS (WGS-84) 转 高德地图坐标系 (GCJ-02)
 */
export function wgs84ToGcj02(
  lng: number,
  lat: number
): { lng: number; lat: number } {
  if (outOfMainlandChina(lng, lat)) {
    return { lng, lat };
  }
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((AXIS * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return {
    lng: Number((lng + dLng).toFixed(6)),
    lat: Number((lat + dLat).toFixed(6)),
  };
}

/**
 * 格式化距离展示（如 "85m" / "1.2km"）
 */
export function formatDistance(meters?: number | null): string {
  if (meters === undefined || meters === null || Number.isNaN(meters)) {
    return '';
  }
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * 估算步行耗时（分钟，按成年人急行 75m/分钟 计算）
 */
export function estimateWalkMinutes(meters?: number | null): number {
  if (!meters || meters <= 0) return 1;
  return Math.max(1, Math.round(meters / 75));
}

/**
 * 热门城市快速切换点（GCJ-02 坐标）
 */
export const CITY_HOTSPOTS = [
  { name: '北京·天安门/王府井', lng: 116.397428, lat: 39.90923 },
  { name: '北京·三里屯太古里', lng: 116.4551, lat: 39.9373 },
  { name: '上海·人民广场', lng: 121.4737, lat: 31.2304 },
  { name: '广州·天河城商圈', lng: 113.3213, lat: 23.1322 },
  { name: '深圳·福田市民中心', lng: 114.0579, lat: 22.5431 },
  { name: '杭州·西湖湖滨银泰', lng: 120.1614, lat: 30.2553 },
];
