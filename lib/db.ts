// lib/db.ts
// 内置 SQLite (node:sqlite) 数据持久化与空间查询层，与 Prisma Schema 一一对应

import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { getBoundingBox, haversineDistance } from '@/lib/geo';
import { generateId } from '@/lib/utils';
import type {
  AuthUser,
  ToiletItem,
  ToiletPhotoItem,
  ToiletSource,
  ToiletStatus,
  UserRole,
} from '@/types';

// 使用动态 require 避免客户端打包器解析 node:sqlite
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

type SQLiteDB = InstanceType<typeof DatabaseSync>;

declare global {
  // eslint-disable-next-line no-var
  var __zzcsSqliteDb: SQLiteDB | undefined;
}

function getDbFilePath(): string {
  if (process.env.POCKETBAY_DATA_DIR) {
    return path.resolve(process.env.POCKETBAY_DATA_DIR, 'zhizhaocesuo.db');
  }
  const configured = process.env.SQLITE_DB_PATH || './data/zhizhaocesuo.db';
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

export function getDb(): SQLiteDB {
  if (globalThis.__zzcsSqliteDb) {
    return globalThis.__zzcsSqliteDb;
  }

  const dbPath = getDbFilePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  initSchema(db);
  seedDatabaseIfNeeded(db);

  globalThis.__zzcsSqliteDb = db;
  return db;
}

function initSchema(db: SQLiteDB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS toilets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      address TEXT,
      source TEXT NOT NULL DEFAULT 'USER',
      status TEXT NOT NULL DEFAULT 'PRIVATE',
      amap_id TEXT UNIQUE,
      is_free INTEGER DEFAULT 1,
      has_paper INTEGER,
      has_accessible INTEGER,
      opening_hours TEXT,
      floor TEXT,
      description TEXT,
      avg_rating REAL NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      rejected_reason TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_toilets_lng_lat ON toilets(lng, lat);
    CREATE INDEX IF NOT EXISTS idx_toilets_status ON toilets(status);
    CREATE INDEX IF NOT EXISTS idx_toilets_created_by ON toilets(created_by);

    CREATE TABLE IF NOT EXISTS toilet_photos (
      id TEXT PRIMARY KEY,
      toilet_id TEXT NOT NULL,
      photo_url TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_photos_toilet_id ON toilet_photos(toilet_id);

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      toilet_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      rating INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_comments_toilet_created ON comments(toilet_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
  `);
}

function toNullableBool(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  return Number(val) === 1;
}

function mapToiletRow(row: Record<string, any>, currentUserId?: string): ToiletItem {
  return {
    id: String(row.id),
    name: String(row.name),
    lng: Number(row.lng),
    lat: Number(row.lat),
    address: row.address ?? null,
    source: (row.source as ToiletSource) || 'USER',
    status: (row.status as ToiletStatus) || 'PUBLIC',
    amapId: row.amap_id ?? null,
    isFree: row.is_free === null || row.is_free === undefined ? true : Number(row.is_free) === 1,
    hasPaper: toNullableBool(row.has_paper),
    hasAccessible: toNullableBool(row.has_accessible),
    openingHours: row.opening_hours ?? null,
    floor: row.floor ?? null,
    description: row.description ?? null,
    avgRating: Number(row.avg_rating || 0),
    commentCount: Number(row.comment_count || 0),
    verifiedAt: row.verified_at ?? null,
    rejectedReason: row.rejected_reason ?? null,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    isOwn: Boolean(currentUserId && row.created_by === currentUserId),
    hasPhoto: Boolean(row.has_photo),
  };
}

function seedDatabaseIfNeeded(db: SQLiteDB) {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as
    | { cnt: number }
    | undefined;
  if (countRow && Number(countRow.cnt) > 0) {
    return;
  }

  const now = Date.now();
  const iso = (msOffset = 0) => new Date(now + msOffset).toISOString();

  const adminHash = bcrypt.hashSync('admin123', 10);
  const userHash = bcrypt.hashSync('123456', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, nickname, avatar_url, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('u_admin', 'admin', adminHash, '系统管理员', null, 'SUPER_ADMIN', iso(-86400000 * 30), iso(-86400000 * 30));
  insertUser.run('u_demo', 'demo_user', userHash, '找厕达人小王', null, 'USER', iso(-86400000 * 15), iso(-86400000 * 15));
  insertUser.run('u_explorer', 'explorer', userHash, '厕所探索家', null, 'USER', iso(-86400000 * 12), iso(-86400000 * 12));
  insertUser.run('u_walker', 'city_walker', userHash, '城市漫步者', null, 'USER', iso(-86400000 * 10), iso(-86400000 * 10));
  insertUser.run('u_passerby', 'luren_jia', userHash, '路人甲', null, 'USER', iso(-86400000 * 8), iso(-86400000 * 8));

  const insertToilet = db.prepare(`
    INSERT INTO toilets (
      id, name, lng, lat, address, source, status, amap_id,
      is_free, has_paper, has_accessible, opening_hours, floor, description,
      avg_rating, comment_count, verified_at, rejected_reason, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedToilets = [
    // ===== 北京·天安门 / 王府井商圈（默认中心 116.397428, 39.90923） =====
    {
      id: 't_bj_wfj_apm',
      name: '北京apm购物中心 B1 东区洗手间',
      lng: 116.41142,
      lat: 39.91358,
      address: '北京市东城区王府井大街138号北京apm B1层',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '10:00-22:00',
      floor: 'B1',
      description: '下扶梯右转走到头即是，非常干净，长期有卷纸、擦手纸和温水洗手液，带独立母婴室。',
      verifiedAt: iso(-86400000 * 10),
      createdBy: 'u_demo',
      photo: '/demo-photos/mall-restroom.svg',
    },
    {
      id: 't_bj_changpuhe',
      name: '菖蒲河公园西侧市政星级公厕',
      lng: 116.40186,
      lat: 39.90835,
      address: '北京市东城区东长安街天安门东侧菖蒲河公园南门旁',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '24小时',
      floor: '1F',
      description: '距离天安门东地铁站B口步行约150米，市政三星级公厕，门口有人脸识别免费取纸机。',
      verifiedAt: iso(-86400000 * 9),
      createdBy: 'u_explorer',
      photo: '/demo-photos/park-toilet.svg',
    },
    {
      id: 't_bj_zhongshan_east',
      name: '劳动人民文化宫东门外公共厕所',
      lng: 116.39925,
      lat: 39.91068,
      address: '北京市东城区南池子大街西侧近天安门东',
      source: 'AMAP',
      status: 'PUBLIC',
      amapId: 'seed_amap_bj_001',
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '24小时',
      floor: '1F',
      description: '街边独立公厕，不用买门票进公园即可使用，内急救星！',
      verifiedAt: iso(-86400000 * 12),
      createdBy: 'u_admin',
      photo: '/demo-photos/park-toilet.svg',
    },
    {
      id: 't_bj_tiananmen_west_sub',
      name: '地铁1号线天安门西站 B口通道公厕',
      lng: 116.39165,
      lat: 39.90748,
      address: '北京市西城区东长安街天安门西地铁站站厅B口外侧',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 0,
      hasAccessible: 1,
      openingHours: '05:30-23:30',
      floor: 'B1',
      description: '位于安检口外侧通道，不坐地铁也能进。早晚高峰偶有排队，建议自备纸巾。',
      verifiedAt: iso(-86400000 * 7),
      createdBy: 'u_walker',
      photo: '/demo-photos/subway-toilet.svg',
    },
    {
      id: 't_bj_ncpa_north',
      name: '国家大剧院北广场地下连廊公厕',
      lng: 116.38995,
      lat: 39.90562,
      address: '北京市西城区西长安街2号北侧绿地旁',
      source: 'AMAP',
      status: 'PUBLIC',
      amapId: 'seed_amap_bj_002',
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '07:00-22:00',
      floor: 'B1',
      description: '环境极佳，冬天有暖气夏天有空调。',
      verifiedAt: iso(-86400000 * 6),
      createdBy: 'u_admin',
      photo: null,
    },
    {
      id: 't_bj_private_demo',
      name: '南池子胡同口书店二楼隐藏洗手间（私人备忘）',
      lng: 116.4036,
      lat: 39.9114,
      address: '北京市东城区南池子大街66号附近',
      source: 'USER',
      status: 'PRIVATE',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 0,
      openingHours: '09:30-20:30',
      floor: '2F',
      description: '上次路过没来得及拍照，先记在自己的私人地图里，门锁密码是 1234#。',
      verifiedAt: null,
      createdBy: 'u_demo',
      photo: null,
    },
    {
      id: 't_bj_pending_cafe',
      name: '王府井东安门大街精品咖啡馆 2F 洗手间',
      lng: 116.4081,
      lat: 39.9122,
      address: '北京市东城区东安门大街55号2层',
      source: 'USER',
      status: 'PENDING',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 0,
      openingHours: '08:00-22:30',
      floor: '2F',
      description: '店员很友好，不消费也可以借用，上二楼右转走到头。已拍门口指引牌待管理员审核！',
      verifiedAt: null,
      createdBy: 'u_demo',
      photo: '/demo-photos/pending-entrance.svg',
    },

    // ===== 北京·三里屯太古里 (116.4551, 39.9373) =====
    {
      id: 't_bj_slt_south',
      name: '三里屯太古里南区 B1 礼宾台旁洗手间',
      lng: 116.45435,
      lat: 39.93565,
      address: '北京市朝阳区三里屯路19号院南区B1层',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '10:00-22:30',
      floor: 'B1',
      description: '五星级干净程度，提供戴森干手机与护手霜，周末下午女卫偶需排队3分钟。',
      verifiedAt: iso(-86400000 * 5),
      createdBy: 'u_explorer',
      photo: '/demo-photos/mall-restroom.svg',
    },
    {
      id: 't_bj_slt_pending',
      name: '机电院内创意园区1号楼大堂公厕',
      lng: 116.4572,
      lat: 39.9369,
      address: '北京市朝阳区工人体育场北路4号院',
      source: 'USER',
      status: 'PENDING',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '08:00-23:00',
      floor: '1F',
      description: '园区办公楼一楼大堂右侧，几乎不用排队，比商场里快很多！',
      verifiedAt: null,
      createdBy: 'u_walker',
      photo: '/demo-photos/pending-entrance.svg',
    },

    // ===== 上海·人民广场 (121.4737, 31.2304) =====
    {
      id: 't_sh_raffles',
      name: '上海来福士广场 B1 地铁连廊洗手间',
      lng: 121.4765,
      lat: 31.2318,
      address: '上海市黄浦区西藏中路268号来福士广场B1层',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '10:00-22:00',
      floor: 'B1',
      description: '人民广场站15号口直通商场B1，干净整洁有纸。',
      verifiedAt: iso(-86400000 * 6),
      createdBy: 'u_explorer',
      photo: '/demo-photos/mall-restroom.svg',
    },
    {
      id: 't_sh_people_park',
      name: '人民公园5号门旁24小时智慧公厕',
      lng: 121.4721,
      lat: 31.2325,
      address: '上海市黄浦区南京西路231号人民公园外侧',
      source: 'AMAP',
      status: 'PUBLIC',
      amapId: 'seed_amap_sh_001',
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '24小时',
      floor: '1F',
      description: '门口电子屏实时显示空余坑位数量，24小时开放。',
      verifiedAt: iso(-86400000 * 6),
      createdBy: 'u_admin',
      photo: '/demo-photos/park-toilet.svg',
    },

    // ===== 广州·天河城商圈 (113.3213, 23.1322) =====
    {
      id: 't_gz_teemall',
      name: '广州天河城购物中心 2F 西北角洗手间',
      lng: 113.3218,
      lat: 23.1328,
      address: '广州市天河区天河路208号天河城2楼',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '10:00-22:00',
      floor: '2F',
      description: '一楼人多，直接扶梯上2楼西北角洗手间最快，有纸有空调。',
      verifiedAt: iso(-86400000 * 4),
      createdBy: 'u_demo',
      photo: '/demo-photos/mall-restroom.svg',
    },

    // ===== 深圳·福田市民中心 (114.0579, 22.5431) =====
    {
      id: 't_sz_cocopark',
      name: '福田市民中心南广场市政公厕',
      lng: 114.0586,
      lat: 22.5422,
      address: '深圳市福田区福中三路市民中心南广场东侧',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '24小时',
      floor: '1F',
      description: '深圳街头星级公厕标杆，配免费纸巾、母婴室、洗手液，通风无异味。',
      verifiedAt: iso(-86400000 * 4),
      createdBy: 'u_explorer',
      photo: '/demo-photos/park-toilet.svg',
    },

    // ===== 杭州·西湖湖滨银泰 (120.1614, 30.2553) =====
    {
      id: 't_hz_in77',
      name: '湖滨银泰in77 C区 B1 洗手间',
      lng: 120.1622,
      lat: 30.2548,
      address: '杭州市上城区延安路258号湖滨银泰in77 C区B1层',
      source: 'USER',
      status: 'PUBLIC',
      amapId: null,
      isFree: 1,
      hasPaper: 1,
      hasAccessible: 1,
      openingHours: '10:00-22:30',
      floor: 'B1',
      description: '逛西湖内急首选，龙翔桥地铁口直通，冷气充足带纸巾。',
      verifiedAt: iso(-86400000 * 3),
      createdBy: 'u_walker',
      photo: '/demo-photos/mall-restroom.svg',
    },
  ];

  const insertPhoto = db.prepare(`
    INSERT INTO toilet_photos (id, toilet_id, photo_url, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const t of seedToilets) {
    insertToilet.run(
      t.id,
      t.name,
      t.lng,
      t.lat,
      t.address,
      t.source,
      t.status,
      t.amapId,
      t.isFree,
      t.hasPaper,
      t.hasAccessible,
      t.openingHours,
      t.floor,
      t.description,
      0,
      0,
      t.verifiedAt,
      null,
      t.createdBy,
      iso(-86400000 * 5),
      iso(-86400000 * 2)
    );
    if (t.photo) {
      insertPhoto.run(
        generateId('ph'),
        t.id,
        t.photo,
        t.createdBy,
        iso(-86400000 * 5)
      );
    }
  }

  const insertComment = db.prepare(`
    INSERT INTO comments (id, toilet_id, user_id, content, rating, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seedComments = [
    {
      toiletId: 't_bj_changpuhe',
      userId: 'u_explorer',
      content: '刚去过，非常干净，门口刷脸机器出纸很顺畅，有洗手液。推荐！',
      rating: 5,
      offsetMs: -3 * 60 * 1000, // 3分钟前
    },
    {
      toiletId: 't_bj_changpuhe',
      userId: 'u_passerby',
      content: '还行，就是旅游团路过时人稍多要排队，等了大概3分钟。',
      rating: 4,
      offsetMs: -2 * 3600 * 1000, // 2小时前
    },
    {
      toiletId: 't_bj_changpuhe',
      userId: 'u_walker',
      content: '24小时开门真的很良心，晚上看完夜景散步过来也能上！',
      rating: 5,
      offsetMs: -28 * 3600 * 1000, // 昨天
    },
    {
      toiletId: 't_bj_zhongshan_east',
      userId: 'u_demo',
      content: '离天安门东特别近，而且在公园检票口外面，完全免费不用买票！',
      rating: 5,
      offsetMs: -25 * 60 * 1000,
    },
    {
      toiletId: 't_bj_zhongshan_east',
      userId: 'u_passerby',
      content: '最里面那个隔间门锁有点松，其他坑位都挺好，今天有纸。',
      rating: 4,
      offsetMs: -3 * 86400 * 1000,
    },
    {
      toiletId: 't_bj_tiananmen_west_sub',
      userId: 'u_walker',
      content: '⚠️ 纸没了！！刚去发现公共卷纸用完了，大家注意自备纸巾！',
      rating: 3,
      offsetMs: -45 * 60 * 1000,
    },
    {
      toiletId: 't_bj_wfj_apm',
      userId: 'u_explorer',
      content: '王府井逛街首选这家，B1东区比一楼人少一半，保洁阿姨打扫很勤快。',
      rating: 5,
      offsetMs: -90 * 60 * 1000,
    },
    {
      toiletId: 't_bj_slt_south',
      userId: 'u_demo',
      content: '不愧是太古里，洗手台还有温水和护手霜，非常干净。',
      rating: 5,
      offsetMs: -4 * 3600 * 1000,
    },
  ];

  for (const c of seedComments) {
    const ts = iso(c.offsetMs);
    insertComment.run(
      generateId('cm'),
      c.toiletId,
      c.userId,
      c.content,
      c.rating,
      ts,
      ts
    );
  }

  // 重新汇总所有厕所的评分与留言数
  const allToiletIds = seedToilets.map((t) => t.id);
  for (const tid of allToiletIds) {
    recalculateToiletStats(db, tid);
  }
}

export function recalculateToiletStats(db: SQLiteDB, toiletId: string) {
  const row = db
    .prepare(
      `SELECT 
         COUNT(*) as total_comments,
         AVG(CASE WHEN rating IS NOT NULL THEN rating END) as avg_rating
       FROM comments
       WHERE toilet_id = ?`
    )
    .get(toiletId) as { total_comments: number; avg_rating: number | null } | undefined;

  const totalComments = Number(row?.total_comments || 0);
  const avgRating = row?.avg_rating ? Number(Number(row.avg_rating).toFixed(1)) : 0;

  db.prepare(
    `UPDATE toilets SET avg_rating = ?, comment_count = ?, updated_at = ? WHERE id = ?`
  ).run(avgRating, totalComments, new Date().toISOString(), toiletId);
}

// ==================== 空间与业务查询封装 ====================

export interface QueryToiletsOptions {
  lng: number;
  lat: number;
  radius: number;
  bounds?: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  } | null;
  page?: number;
  limit?: number;
  userId?: string;
  isFree?: boolean;
  hasPaper?: boolean;
  hasAccessible?: boolean;
  onlyMine?: boolean;
  keyword?: string;
}

export function queryNearbyToilets(opts: QueryToiletsOptions): {
  toilets: ToiletItem[];
  total: number;
  hasMore: boolean;
} {
  const db = getDb();
  const {
    lng,
    lat,
    radius,
    bounds,
    page = 1,
    limit = 300,
    userId,
    isFree,
    hasPaper,
    hasAccessible,
    onlyMine,
    keyword,
  } = opts;

  const radiusBox = getBoundingBox(lng, lat, radius);
  const minLat = bounds ? Math.min(radiusBox.minLat, bounds.minLat) : radiusBox.minLat;
  const maxLat = bounds ? Math.max(radiusBox.maxLat, bounds.maxLat) : radiusBox.maxLat;
  const minLng = bounds ? Math.min(radiusBox.minLng, bounds.minLng) : radiusBox.minLng;
  const maxLng = bounds ? Math.max(radiusBox.maxLng, bounds.maxLng) : radiusBox.maxLng;

  const conditions: string[] = [
    't.lat >= ?',
    't.lat <= ?',
    't.lng >= ?',
    't.lng <= ?',
  ];
  const params: (string | number)[] = [
    minLat,
    maxLat,
    minLng,
    maxLng,
  ];

  if (onlyMine && userId) {
    conditions.push('t.created_by = ?');
    params.push(userId);
  } else if (userId) {
    conditions.push(
      `(t.status = 'PUBLIC' OR (t.status IN ('PRIVATE', 'PENDING', 'REJECTED') AND t.created_by = ?))`
    );
    params.push(userId);
  } else {
    conditions.push(`t.status = 'PUBLIC'`);
  }

  if (isFree) {
    conditions.push('t.is_free = 1');
  }
  if (hasPaper) {
    conditions.push('t.has_paper = 1');
  }
  if (hasAccessible) {
    conditions.push('t.has_accessible = 1');
  }
  if (keyword && keyword.trim()) {
    conditions.push('(t.name LIKE ? OR t.address LIKE ? OR t.description LIKE ?)');
    const kw = `%${keyword.trim()}%`;
    params.push(kw, kw, kw);
  }

  const sql = `
    SELECT 
      t.*,
      EXISTS(SELECT 1 FROM toilet_photos tp WHERE tp.toilet_id = t.id) as has_photo
    FROM toilets t
    WHERE ${conditions.join(' AND ')}
  `;

  const rawRows = db.prepare(sql).all(...params) as Record<string, any>[];

  const withinRadius: ToiletItem[] = [];
  for (const row of rawRows) {
    const rLng = Number(row.lng);
    const rLat = Number(row.lat);
    const dist = haversineDistance(lng, lat, rLng, rLat);
    const inViewport =
      bounds &&
      rLng >= bounds.minLng &&
      rLng <= bounds.maxLng &&
      rLat >= bounds.minLat &&
      rLat <= bounds.maxLat;

    if (dist <= radius || inViewport) {
      const item = mapToiletRow(row, userId);
      item.distance = dist;
      withinRadius.push(item);
    }
  }

  withinRadius.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

  const offset = (page - 1) * limit;
  const paged = withinRadius.slice(offset, offset + limit);

  return {
    toilets: paged,
    total: withinRadius.length,
    hasMore: offset + limit < withinRadius.length,
  };
}

export function getToiletById(
  id: string,
  currentUserId?: string,
  currentUserRole?: UserRole
): ToiletItem | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 
         t.*,
         u.username as creator_username,
         u.nickname as creator_nickname,
         EXISTS(SELECT 1 FROM toilet_photos tp WHERE tp.toilet_id = t.id) as has_photo
       FROM toilets t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.id = ?`
    )
    .get(id) as Record<string, any> | undefined;

  if (!row) return null;

  const isAdmin =
    currentUserRole === 'ADMIN' || currentUserRole === 'SUPER_ADMIN';
  const isOwner = Boolean(currentUserId && row.created_by === currentUserId);

  // 私有或非公开厕所仅创建者本人或管理员可访问详情
  if (row.status !== 'PUBLIC' && !isOwner && !isAdmin) {
    return null;
  }

  const photosRows = db
    .prepare(
      `SELECT id, toilet_id, photo_url, uploaded_by, created_at
       FROM toilet_photos
       WHERE toilet_id = ?
       ORDER BY created_at DESC`
    )
    .all(id) as Record<string, any>[];

  const photos: ToiletPhotoItem[] = photosRows.map((p) => ({
    id: String(p.id),
    toiletId: String(p.toilet_id),
    photoUrl: String(p.photo_url),
    uploadedBy: String(p.uploaded_by),
    createdAt: String(p.created_at),
  }));

  const item = mapToiletRow(row, currentUserId);
  item.photos = photos;
  item.creator = {
    id: String(row.created_by),
    username: String(row.creator_username || 'user'),
    nickname: String(row.creator_nickname || row.creator_username || '热心用户'),
  };
  return item;
}

export function getSystemAdminId(): string {
  const db = getDb();
  const row = db
    .prepare(`SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN') LIMIT 1`)
    .get() as { id: string } | undefined;
  if (row?.id) return String(row.id);

  const anyRow = db.prepare(`SELECT id FROM users LIMIT 1`).get() as
    | { id: string }
    | undefined;
  return anyRow?.id ? String(anyRow.id) : 'u_admin';
}

export function findUserById(id: string): AuthUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, username, nickname, avatar_url, role, created_at FROM users WHERE id = ?`
    )
    .get(id) as Record<string, any> | undefined;

  if (!row) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    nickname: String(row.nickname || row.username),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    role: (row.role as UserRole) || 'USER',
    createdAt: String(row.created_at),
  };
}
