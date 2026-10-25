// lib/db.ts
// 内置 SQLite (node:sqlite) 数据持久化与空间查询层，与 Prisma Schema 一一对应

import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { getBoundingBox, haversineDistance } from '@/lib/geo';
import { generateId } from '@/lib/utils';
import type {
  AuthUser,
  InferredCategory,
  ToiletItem,
  ToiletPhotoItem,
  ToiletSource,
  ToiletStatus,
  UserRole,
  VerificationVoteType,
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
  ensureSeedInferredExamples(db);

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
      inferred_category TEXT,
      inferred_hidden INTEGER DEFAULT 0,
      is_free INTEGER DEFAULT 1,
      has_paper INTEGER,
      has_accessible INTEGER,
      opening_hours TEXT,
      floor TEXT,
      description TEXT,
      avg_rating REAL NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      admin_verified INTEGER DEFAULT 0,
      verified_at TEXT,
      last_synced_at TEXT,
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

    CREATE TABLE IF NOT EXISTS toilet_verifications (
      id TEXT PRIMARY KEY,
      toilet_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(toilet_id, user_id),
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_verifications_toilet ON toilet_verifications(toilet_id);

    CREATE TABLE IF NOT EXISTS amap_sync_cells (
      cell_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      center_lng REAL NOT NULL,
      center_lat REAL NOT NULL,
      radius INTEGER NOT NULL,
      poi_count INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_amap_sync_cells_time ON amap_sync_cells(synced_at);
  `);

  // 兼容已有线上持久化数据库的无损平滑加列迁移（绝不覆盖或丢失旧数据）
  const cols = db.prepare(`PRAGMA table_info(toilets)`).all() as {
    name: string;
  }[];
  const colNames = new Set(cols.map((c) => String(c.name)));
  if (!colNames.has('inferred_category')) {
    db.exec(`ALTER TABLE toilets ADD COLUMN inferred_category TEXT;`);
  }
  if (!colNames.has('inferred_hidden')) {
    db.exec(`ALTER TABLE toilets ADD COLUMN inferred_hidden INTEGER DEFAULT 0;`);
  }
  if (!colNames.has('admin_verified')) {
    db.exec(`ALTER TABLE toilets ADD COLUMN admin_verified INTEGER DEFAULT 0;`);
  }
  if (!colNames.has('last_synced_at')) {
    db.exec(`ALTER TABLE toilets ADD COLUMN last_synced_at TEXT;`);
  }
}

function toNullableBool(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  return Number(val) === 1;
}

function mapToiletRow(row: Record<string, any>, currentUserId?: string): ToiletItem {
  const myVoteRaw = row.my_vote ? String(row.my_vote) : null;
  const myVote: VerificationVoteType | null =
    myVoteRaw === 'AVAILABLE' || myVoteRaw === 'UNAVAILABLE'
      ? myVoteRaw
      : null;

  return {
    id: String(row.id),
    name: String(row.name),
    lng: Number(row.lng),
    lat: Number(row.lat),
    address: row.address ?? null,
    source: (row.source as ToiletSource) || 'USER',
    status: (row.status as ToiletStatus) || 'PUBLIC',
    amapId: row.amap_id ?? null,
    inferredCategory: (row.inferred_category as InferredCategory) ?? null,
    inferredHidden: Number(row.inferred_hidden || 0) === 1,
    availableVotes: Number(row.available_votes || 0),
    unavailableVotes: Number(row.unavailable_votes || 0),
    myVote,
    isFree: row.is_free === null || row.is_free === undefined ? true : Number(row.is_free) === 1,
    hasPaper: toNullableBool(row.has_paper),
    hasAccessible: toNullableBool(row.has_accessible),
    openingHours: row.opening_hours ?? null,
    floor: row.floor ?? null,
    description: row.description ?? null,
    avgRating: Number(row.avg_rating || 0),
    commentCount: Number(row.comment_count || 0),
    adminVerified: Number(row.admin_verified || 0) === 1,
    verifiedAt: row.verified_at ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
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

function ensureSeedInferredExamples(db: SQLiteDB) {
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO toilets (
      id, name, lng, lat, address, source, status, amap_id,
      inferred_category, inferred_hidden, is_free, opening_hours,
      description, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'INFERRED', 'PUBLIC', ?, ?, 0, 1, ?, ?, 'u_admin', ?, ?)
  `);

  const inferredSeeds: {
    id: string;
    name: string;
    lng: number;
    lat: number;
    address: string;
    amapId: string;
    cat: InferredCategory;
    hours: string;
    desc: string;
  }[] = [
    {
      id: 't_inf_bj_pumch',
      name: '北京协和医院(东单院区)门诊大楼',
      lng: 116.4158,
      lat: 39.9128,
      address: '北京市东城区帅府园一号',
      amapId: 'inf_amap_seed_pumch',
      cat: 'HOSPITAL',
      hours: '门诊时段 / 急诊24h',
      desc: '推测点位：医院、社区卫生服务中心及乡镇卫生院门诊一楼大厅与各楼层通常配有免费公共卫生间（未核实，以现场为准）。',
    },
    {
      id: 't_inf_bj_wfj_dept',
      name: '北京市百货大楼(王府井店)',
      lng: 116.4106,
      lat: 39.9136,
      address: '北京市东城区王府井大街255号',
      amapId: 'inf_amap_seed_wfj_dept',
      cat: 'MALL',
      hours: '约 10:00-22:00',
      desc: '推测点位：商场与购物中心营业时间内各楼层（常见于 B1 或 2F 以上走廊尽头）一般设有免费洗手间（未核实，请注意营业时间）。',
    },
    {
      id: 't_inf_bj_qianmen_kfc',
      name: '肯德基(前门东大街餐厅)',
      lng: 116.4018,
      lat: 39.9008,
      address: '北京市东城区前门东大街甲2号',
      amapId: 'inf_amap_seed_qm_kfc',
      cat: 'FAST_FOOD',
      hours: '约 07:00-23:00',
      desc: '推测点位：肯德基、麦当劳、星巴克等大型连锁门店店内或所在楼层通常设有洗手间（未核实，以门店现场为准）。',
    },
    {
      id: 't_inf_bj_sinopec',
      name: '中国石化(东单加油站)',
      lng: 116.4195,
      lat: 39.9072,
      address: '北京市东城区东单北大街旁',
      amapId: 'inf_amap_seed_sinopec_dd',
      cat: 'GAS_STATION',
      hours: '多数 24 小时',
      desc: '推测点位：加油站便利店旁或站区侧方普遍配有免费对外卫生间，适合城郊与夜间应急（未核实，以站内规定为准）。',
    },
    {
      id: 't_inf_bj_zhongshan_park',
      name: '中山公园南门游客服务中心',
      lng: 116.3935,
      lat: 39.9082,
      address: '北京市东城区中华路4号',
      amapId: 'inf_amap_seed_zspark',
      cat: 'PARK',
      hours: '公园开放时段',
      desc: '推测点位：开放式公园、市民广场及游客中心内部通常配有免费公厕（未核实，部分收费景区需注意检票口位置）。',
    },
    {
      id: 't_inf_bj_grand_hotel',
      name: '北京贵宾楼饭店(大堂)',
      lng: 116.4052,
      lat: 39.9086,
      address: '北京市东城区东长安街35号',
      amapId: 'inf_amap_seed_grandhotel',
      cat: 'HOTEL',
      hours: '大堂 24 小时',
      desc: '推测点位：星级及中高端连锁酒店一楼大堂休息区旁通常设有公共洗手间，应急时可礼貌借用（未核实，以酒店现场为准）。',
    },
    {
      id: 't_inf_bj_archive_lib',
      name: '东城区政务服务中心/图书馆驿站',
      lng: 116.4175,
      lat: 39.9182,
      address: '北京市东城区金宝街52号',
      amapId: 'inf_amap_seed_dc_civic',
      cat: 'GOV_CIVIC',
      hours: '工作日 / 开放时段',
      desc: '推测点位：政务服务大厅、党群驿站、公共图书馆及博物馆开放时段内通常配有干净免费卫生间（未核实，节假日或晚间可能闭馆）。',
    },
    {
      id: 't_inf_bj_wumart',
      name: '物美大卖场(崇文门店)',
      lng: 116.4182,
      lat: 39.8992,
      address: '北京市东城区崇文门外大街',
      amapId: 'inf_amap_seed_wumart_cwm',
      cat: 'SUPERMARKET',
      hours: '约 08:00-22:00',
      desc: '推测点位：大中型综合超市服务台旁、收银区外侧通常可借用卫生间（未核实，小型便利店除外）。',
    },
  ];

  for (const s of inferredSeeds) {
    stmt.run(
      s.id,
      s.name,
      s.lng,
      s.lat,
      s.address,
      s.amapId,
      s.cat,
      s.hours,
      s.desc,
      nowIso,
      nowIso
    );
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
  userLng?: number;
  userLat?: number;
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
  includeInferred?: boolean;
  inferredCategory?: InferredCategory | 'ALL' | null;
}

export function countConfirmedToiletsWithin(
  lng: number,
  lat: number,
  meters = 500
): number {
  const db = getDb();
  const box = getBoundingBox(lng, lat, meters);
  const rows = db
    .prepare(
      `SELECT lng, lat FROM toilets
       WHERE status = 'PUBLIC'
         AND source != 'INFERRED'
         AND (COALESCE(inferred_hidden, 0) = 0 OR COALESCE(admin_verified, 0) = 1)
         AND lat >= ? AND lat <= ?
         AND lng >= ? AND lng <= ?`
    )
    .all(box.minLat, box.maxLat, box.minLng, box.maxLng) as {
    lng: number;
    lat: number;
  }[];

  let count = 0;
  for (const r of rows) {
    if (haversineDistance(lng, lat, Number(r.lng), Number(r.lat)) <= meters) {
      count++;
    }
  }
  return count;
}

export function countRecentUserPhotos(userId: string, minutes = 10): number {
  const db = getDb();
  const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM toilet_photos WHERE uploaded_by = ? AND created_at >= ?`
    )
    .get(userId, sinceIso) as { cnt: number } | undefined;
  return Number(row?.cnt || 0);
}

export function queryNearbyToilets(opts: QueryToiletsOptions): {
  toilets: ToiletItem[];
  total: number;
  hasMore: boolean;
  confirmedWithin500m: number;
} {
  const db = getDb();
  const {
    lng,
    lat,
    userLng,
    userLat,
    radius,
    bounds,
    page = 1,
    limit = 350,
    userId,
    isFree,
    hasPaper,
    hasAccessible,
    onlyMine,
    keyword,
    includeInferred = false,
    inferredCategory = null,
  } = opts;

  const originLng =
    typeof userLng === 'number' && Number.isFinite(userLng) ? userLng : lng;
  const originLat =
    typeof userLat === 'number' && Number.isFinite(userLat) ? userLat : lat;

  const confirmedWithin500m = countConfirmedToiletsWithin(
    originLng,
    originLat,
    500
  );

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
    conditions.push(`t.source != 'INFERRED'`);
    params.push(userId);
  } else {
    if (userId) {
      conditions.push(
        `(t.status = 'PUBLIC' OR (t.status IN ('PRIVATE', 'PENDING', 'REJECTED') AND t.created_by = ?))`
      );
      params.push(userId);
    } else {
      conditions.push(`t.status = 'PUBLIC'`);
    }

    // 排除已下线/被多人反馈无效的点位（管理员亲自实地认证的点位永久受保护不隐藏）
    conditions.push(
      `(COALESCE(t.inferred_hidden, 0) = 0 OR COALESCE(t.admin_verified, 0) = 1)`
    );

    if (!includeInferred) {
      conditions.push(`t.source != 'INFERRED'`);
    } else {
      if (inferredCategory && inferredCategory !== 'ALL') {
        conditions.push(
          `(t.source != 'INFERRED' OR t.inferred_category = ?)`
        );
        params.push(inferredCategory);
      }
    }
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

  const myVoteSelect = userId
    ? `(SELECT tv.vote FROM toilet_verifications tv WHERE tv.toilet_id = t.id AND tv.user_id = ? LIMIT 1) as my_vote`
    : `NULL as my_vote`;
  const selectParams: (string | number)[] = userId ? [userId, ...params] : params;

  const sql = `
    SELECT 
      t.*,
      EXISTS(SELECT 1 FROM toilet_photos tp WHERE tp.toilet_id = t.id) as has_photo,
      (SELECT COUNT(*) FROM toilet_verifications tv WHERE tv.toilet_id = t.id AND tv.vote = 'AVAILABLE') as available_votes,
      (SELECT COUNT(*) FROM toilet_verifications tv WHERE tv.toilet_id = t.id AND tv.vote = 'UNAVAILABLE') as unavailable_votes,
      ${myVoteSelect}
    FROM toilets t
    WHERE ${conditions.join(' AND ')}
  `;

  const rawRows = db.prepare(sql).all(...selectParams) as Record<string, any>[];

  const confirmedCoords: { lng: number; lat: number }[] = [];
  const candidates: ToiletItem[] = [];

  for (const row of rawRows) {
    const rLng = Number(row.lng);
    const rLat = Number(row.lat);
    const viewDist = haversineDistance(lng, lat, rLng, rLat);
    const userDist = haversineDistance(originLng, originLat, rLng, rLat);
    const inViewport =
      bounds &&
      rLng >= bounds.minLng &&
      rLng <= bounds.maxLng &&
      rLat >= bounds.minLat &&
      rLat <= bounds.maxLat;

    if (viewDist <= radius || inViewport) {
      const item = mapToiletRow(row, userId);
      item.straightDistance = userDist;
      item.distance = userDist;
      if (item.source !== 'INFERRED') {
        confirmedCoords.push({ lng: rLng, lat: rLat });
      }
      candidates.push(item);
    }
  }

  // 若某个推测场所 35 米内已经有明确确认的公厕 POI，则隐藏该重复推测点，避免重叠干扰
  const withinRadius = candidates.filter((item) => {
    if (item.source !== 'INFERRED') return true;
    return !confirmedCoords.some(
      (c) => haversineDistance(item.lng, item.lat, c.lng, c.lat) < 35
    );
  });

  withinRadius.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

  const offset = (page - 1) * limit;
  const paged = withinRadius.slice(offset, offset + limit);

  return {
    toilets: paged,
    total: withinRadius.length,
    hasMore: offset + limit < withinRadius.length,
    confirmedWithin500m,
  };
}

export function getToiletById(
  id: string,
  currentUserId?: string,
  currentUserRole?: UserRole
): ToiletItem | null {
  const db = getDb();
  const myVoteSelect = currentUserId
    ? `(SELECT tv.vote FROM toilet_verifications tv WHERE tv.toilet_id = t.id AND tv.user_id = ? LIMIT 1) as my_vote`
    : `NULL as my_vote`;
  const getParams: string[] = currentUserId ? [currentUserId, id] : [id];

  const row = db
    .prepare(
      `SELECT 
         t.*,
         u.username as creator_username,
         u.nickname as creator_nickname,
         EXISTS(SELECT 1 FROM toilet_photos tp WHERE tp.toilet_id = t.id) as has_photo,
         (SELECT COUNT(*) FROM toilet_verifications tv WHERE tv.toilet_id = t.id AND tv.vote = 'AVAILABLE') as available_votes,
         (SELECT COUNT(*) FROM toilet_verifications tv WHERE tv.toilet_id = t.id AND tv.vote = 'UNAVAILABLE') as unavailable_votes,
         ${myVoteSelect}
       FROM toilets t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.id = ?`
    )
    .get(...getParams) as Record<string, any> | undefined;

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

// ==================== 全站共享区域冷却缓存（持久化于 SQLite /data） ====================

/**
 * 将经纬度量化为约 1.1km × 1.1km 的共享街区网格（远小于 2.5km~6km 的高德周边检索半径，确保相邻网格完全覆盖无死角）
 */
export function makeSharedAreaCellKey(
  kind: 'AROUND' | 'INFERRED',
  lng: number,
  lat: number
): string {
  const gLng = Math.round(lng * 90);
  const gLat = Math.round(lat * 90);
  return `${kind}:${gLng}_${gLat}`;
}

export interface AreaSyncCellRecord {
  cellKey: string;
  kind: string;
  centerLng: number;
  centerLat: number;
  radius: number;
  poiCount: number;
  syncedAt: number;
}

export function getAreaSyncCell(cellKey: string): AreaSyncCellRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cell_key, kind, center_lng, center_lat, radius, poi_count, synced_at
       FROM amap_sync_cells
       WHERE cell_key = ?`
    )
    .get(cellKey) as Record<string, any> | undefined;

  if (!row) return null;
  return {
    cellKey: String(row.cell_key),
    kind: String(row.kind),
    centerLng: Number(row.center_lng),
    centerLat: Number(row.center_lat),
    radius: Number(row.radius),
    poiCount: Number(row.poi_count || 0),
    syncedAt: Number(row.synced_at || 0),
  };
}

export function recordAreaSyncCell(opts: {
  cellKey: string;
  kind: 'AROUND' | 'INFERRED';
  lng: number;
  lat: number;
  radius: number;
  poiCount: number;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO amap_sync_cells (cell_key, kind, center_lng, center_lat, radius, poi_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cell_key) DO UPDATE SET
       center_lng = excluded.center_lng,
       center_lat = excluded.center_lat,
       radius = excluded.radius,
       poi_count = excluded.poi_count,
       synced_at = excluded.synced_at`
  ).run(
    opts.cellKey,
    opts.kind,
    opts.lng,
    opts.lat,
    Math.round(opts.radius),
    opts.poiCount,
    Date.now()
  );
}

