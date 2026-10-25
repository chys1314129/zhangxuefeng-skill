// lib/inferredVenues.ts
// 8 类「高概率免费可借用卫生间」场所元数据与高德 POI 智能分类过滤规则

import type { InferredCategory } from '@/types';

export interface InferredCategoryInfo {
  key: InferredCategory;
  label: string;
  shortLabel: string;
  emoji: string;
  defaultHours: string;
  hint: string;
}

export const INFERRED_CATEGORY_META: Record<
  InferredCategory,
  InferredCategoryInfo
> = {
  HOSPITAL: {
    key: 'HOSPITAL',
    label: '医院/卫生院',
    shortLabel: '医院卫生院',
    emoji: '🏥',
    defaultHours: '门诊时段 / 急诊24h',
    hint: '推测点位：医院、社区卫生服务中心及乡镇卫生院门诊一楼大厅与各楼层通常配有免费公共卫生间（未核实，以现场为准）。',
  },
  MALL: {
    key: 'MALL',
    label: '商场/购物中心',
    shortLabel: '商场百货',
    emoji: '🏬',
    defaultHours: '约 10:00-22:00',
    hint: '推测点位：商场与购物中心营业时间内各楼层（常见于 B1 或 2F 以上走廊尽头）一般设有免费洗手间（未核实，请注意营业时间）。',
  },
  SUPERMARKET: {
    key: 'SUPERMARKET',
    label: '大中型超市',
    shortLabel: '大中型超市',
    emoji: '🛒',
    defaultHours: '约 08:00-22:00',
    hint: '推测点位：大中型综合超市或市场服务台旁、收银区外侧通常可借用卫生间（未核实，街边小型便利店除外）。',
  },
  PARK: {
    key: 'PARK',
    label: '公园/广场',
    shortLabel: '公园广场',
    emoji: '🌳',
    defaultHours: '公园开放时段',
    hint: '推测点位：开放式公园、市民广场及游客中心内部通常配有免费公厕（未核实，部分收费景区需注意检票口位置）。',
  },
  GAS_STATION: {
    key: 'GAS_STATION',
    label: '加油站',
    shortLabel: '加油站',
    emoji: '⛽',
    defaultHours: '多数 24 小时',
    hint: '推测点位：加油站便利店旁或站区侧方普遍配有免费对外卫生间，适合城郊与夜间应急（未核实，以站内实际规定为准）。',
  },
  FAST_FOOD: {
    key: 'FAST_FOOD',
    label: '连锁快餐/咖啡',
    shortLabel: '快餐咖啡',
    emoji: '🍔',
    defaultHours: '约 07:00-23:00',
    hint: '推测点位：肯德基、麦当劳、星巴克等大型连锁门店店内或所在商场楼层通常设有洗手间（未核实，纯快取档口可能无内设厕位）。',
  },
  GOV_CIVIC: {
    key: 'GOV_CIVIC',
    label: '政务/图书馆/驿站',
    shortLabel: '政务/馆驿',
    emoji: '🏛️',
    defaultHours: '工作日 / 开放时段',
    hint: '推测点位：政务服务大厅、党群驿站、公共图书馆及博物馆开放时段内通常配有干净免费卫生间（未核实，节假日或晚间可能闭馆）。',
  },
  HOTEL: {
    key: 'HOTEL',
    label: '大中型酒店大堂',
    shortLabel: '酒店大堂',
    emoji: '🏨',
    defaultHours: '大堂 24 小时',
    hint: '推测点位：星级及中高端连锁酒店一楼大堂休息区旁通常设有公共洗手间，应急时可礼貌借用（未核实，以酒店现场为准）。',
  },
};

export const INFERRED_CATEGORY_LIST: InferredCategoryInfo[] = [
  INFERRED_CATEGORY_META.HOSPITAL,
  INFERRED_CATEGORY_META.MALL,
  INFERRED_CATEGORY_META.SUPERMARKET,
  INFERRED_CATEGORY_META.PARK,
  INFERRED_CATEGORY_META.GAS_STATION,
  INFERRED_CATEGORY_META.FAST_FOOD,
  INFERRED_CATEGORY_META.GOV_CIVIC,
  INFERRED_CATEGORY_META.HOTEL,
];

export function getInferredCategoryMeta(
  cat?: InferredCategory | string | null
): InferredCategoryInfo {
  if (cat && cat in INFERRED_CATEGORY_META) {
    return INFERRED_CATEGORY_META[cat as InferredCategory];
  }
  return INFERRED_CATEGORY_META.MALL;
}

// 高德 POI 类型串（分成两组以保证单次检索命中率并遵守 3 QPS 限制）
export const AMAP_VENUE_TYPES_BATCH_1 =
  '090100|090101|090102|090200|090300|060100|060101|060102|060103|060400|010100';

export const AMAP_VENUE_TYPES_BATCH_2 =
  '110100|110101|110105|050301|050302|050501|140100|140500|130100|100100|100102|100103|100104';

// 剔除附属出入口、药店、宠物诊所、便利店小卖部、充电桩、民宿招待所等不适合借厕的点位
const VENUE_NOISE_NAME_RE =
  /停车场|地下车库|出入口|[东南西北]门$|[1-9]号门$|药店|大药房|国大药房|老百姓|益丰|一心堂|同仁堂|宠物|动物医院|兽医|口腔诊所|牙科|医美|整形|植发|体检中心|便利店|小卖部|烟酒|士多|美宜佳|全家|7-Eleven|711|罗森|便利蜂|十足|喜士多|芙蓉兴盛|无人超市|菜鸟驿站|丰巢|快递|自助|ATM|充电站|换电站|加气站|民宿|公寓|招待所|旅馆|客栈|青旅|钟点房|网吧|足浴|棋牌/i;

const LARGE_SUPERMARKET_BRAND_RE =
  /大润发|永辉|物美|沃尔玛|山姆|盒马|华润万家|家乐福|联华|世纪联华|华联|步步高|麦德龙|胖东来|大张|武商|中百仓储|天虹|人人乐|京客隆|超市发|永旺|AEON|奥乐齐|比优特|佳惠|新玛特|大商|银座超市|振华超市|生活超市|购物广场|综合超市|大型超市|生鲜超市/;

const CHAIN_FASTFOOD_RE =
  /肯德基|KFC|麦当劳|星巴克|Starbucks|汉堡王|必胜客|德克士|老乡鸡|真功夫|永和大王|大家乐|大快活|萨莉亚/i;

const QUALITY_HOTEL_RE =
  /大酒店|宾馆|国际酒店|星级|亚朵|全季|维也纳|希尔顿|万豪|洲际|喜来登|威斯汀|凯悦|香格里拉|假日酒店|皇冠假日|智选假日|万达嘉华|万达文华|开元名都|锦江都城|丽枫|桔子水晶|桔子酒店|漫心|和颐|美居|诺富特|铂尔曼|温德姆|豪生|建国饭店|花园酒店|迎宾馆/;

const CIVIC_OPEN_RE =
  /政务服务|行政服务|市民中心|便民服务|党群服务|工会驿站|户外劳动者|图书馆|博物馆|文化馆|美术馆|科技馆|青少年宫|游客中心/;

export interface DiscoveredInferredVenue {
  externalId: string;
  name: string;
  lng: number;
  lat: number;
  address: string;
  inferredCategory: InferredCategory;
  openingHours: string;
  description: string;
}

export function classifyAndParseVenuePoi(
  poi: any
): DiscoveredInferredVenue | null {
  const name = String(poi?.name || '').trim();
  if (!name || VENUE_NOISE_NAME_RE.test(name)) {
    return null;
  }

  let lng = 0;
  let lat = 0;
  if (typeof poi?.location === 'string') {
    const parts = poi.location.split(',').map(Number);
    lng = parts[0];
    lat = parts[1];
  } else if (poi?.location) {
    lng = Number(poi.location.lng ?? poi.location.getLng?.());
    lat = Number(poi.location.lat ?? poi.location.getLat?.());
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !lng || !lat) {
    return null;
  }

  const typecode = String(poi?.typecode || '');
  let category: InferredCategory | null = null;

  // 1. 医院 / 社区卫生服务中心 / 卫生院
  if (
    typecode.startsWith('0901') ||
    typecode.startsWith('0902') ||
    typecode.startsWith('0903') ||
    /医院|卫生院|社区卫生服务中心/.test(name)
  ) {
    if (typecode.startsWith('0906') || typecode.startsWith('0907')) {
      return null;
    }
    category = 'HOSPITAL';
  }
  // 2. 商场 / 购物中心 / 百货
  else if (
    typecode.startsWith('0601') ||
    /购物中心|百货|万达广场|万象城|万象汇|吾悦广场|龙湖天街|银泰|大悦城|凯德|印象城|爱琴海|太古里|天河城|恒隆|奥特莱斯/.test(
      name
    )
  ) {
    category = 'MALL';
  }
  // 3. 大中型超市
  else if (typecode.startsWith('0604') || LARGE_SUPERMARKET_BRAND_RE.test(name)) {
    // 过滤面积极小的社区小店：若既非连锁品牌又少于5个字（如“兴旺超市”），跳过以防误导
    if (!LARGE_SUPERMARKET_BRAND_RE.test(name) && name.length <= 5) {
      return null;
    }
    category = 'SUPERMARKET';
  }
  // 4. 加油站
  else if (
    typecode.startsWith('0101') ||
    /中国石化|中国石油|中石化|中石油|壳牌|中国海油|道达尔|加油站/.test(name)
  ) {
    category = 'GAS_STATION';
  }
  // 5. 公园 / 广场 / 游客中心
  else if (
    typecode.startsWith('1101') ||
    /公园|市民广场|文化广场|中心广场|游客中心|游客服务中心/.test(name)
  ) {
    category = 'PARK';
  }
  // 6. 大型连锁快餐 / 咖啡
  else if (
    typecode.startsWith('050301') ||
    typecode.startsWith('050302') ||
    typecode.startsWith('050501') ||
    CHAIN_FASTFOOD_RE.test(name)
  ) {
    if (/甜品站|快取|外卖专门/.test(name)) return null;
    category = 'FAST_FOOD';
  }
  // 7. 政务中心 / 图书馆 / 博物馆 / 党群驿站
  else if (
    typecode.startsWith('1401') ||
    typecode.startsWith('1405') ||
    CIVIC_OPEN_RE.test(name)
  ) {
    if (typecode.startsWith('13') && !CIVIC_OPEN_RE.test(name)) {
      return null;
    }
    category = 'GOV_CIVIC';
  }
  // 8. 星级及中高端连锁酒店大堂
  else if (
    typecode.startsWith('100100') ||
    typecode.startsWith('100101') ||
    typecode.startsWith('100102') ||
    typecode.startsWith('100103') ||
    typecode.startsWith('100104') ||
    QUALITY_HOTEL_RE.test(name)
  ) {
    if (!QUALITY_HOTEL_RE.test(name) && typecode === '100100') {
      return null;
    }
    category = 'HOTEL';
  }

  if (!category) return null;

  const meta = INFERRED_CATEGORY_META[category];
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

  return {
    externalId: `inf_amap_${poi.id}`,
    name,
    lng,
    lat,
    address,
    inferredCategory: category,
    openingHours: meta.defaultHours,
    description: meta.hint,
  };
}
