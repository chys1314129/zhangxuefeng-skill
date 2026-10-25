// lib/amap-server.ts
// 服务端高德 Web服务 API 封装（含超时保护，无外网环境下安全回退）

const AMAP_SERVER_KEY =
  process.env.AMAP_SERVER_KEY || process.env.NEXT_PUBLIC_AMAP_KEY || '';

export async function reverseGeocodeServer(
  lng: number,
  lat: number
): Promise<string> {
  if (!AMAP_SERVER_KEY) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
    url.searchParams.set('key', AMAP_SERVER_KEY);
    url.searchParams.set('location', `${lng},${lat}`);
    const res = await fetch(url.toString(), { signal: controller.signal });
    const data = await res.json();
    if (data?.status === '1') {
      return String(data.regeocode?.formatted_address || '');
    }
    return '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
