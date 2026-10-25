# 🚽 只找厕所 (ZhiZhaoCeSuo)

> **急的时候，打开就能找到** —— 专注于公共厕所定位、一键步行导航、拍照众包共享与实时互助留言板的轻量级网页应用。

---

## ✨ 核心功能

- **🗺️ 双地图引擎 + 实时 POI 融合**：同时支持 **高德地图** 与 **腾讯地图** 一键切换，自动检索周边公共厕所并融合本地众包数据库，内置 WGS-84 → GCJ-02 坐标精准纠偏。
- **🚨 「急！」一键步行导航**：醒目脉冲按钮直达距离最近的可用厕所，支持一键唤起高德地图 / 腾讯地图步行导航及复制楼层找路指引。
- **➕ UGC 众包标记 & 📷 拍照可见性规则**：
  - **上传了实景照片** → 进入 `PENDING`（待审核），管理员核验通过后变为 `PUBLIC`（所有人可见）。
  - **未上传照片** → 自动保存为 `PRIVATE`（仅自己可见的私人备忘标记），日后在详情页或个人中心补拍照片后自动转入 `PENDING` 申请公开。
  - **防重机制**：自动检测 50 米内同名公开厕所，避免重复标记。
- **💬 实时互助留言板**：
  - 按 `created_at DESC` 倒序排列，最新实况置顶。
  - 双时间格式展示（如 `3分钟前 · 10-25 14:32`）。
  - 支持 1–5 星评分、快捷实况标签（`🧻 有纸有洗手液`、`⚠️ 纸没了请自备`、`👥 现在要排队` 等）、500 字上限及同点位每分钟 1 条防刷限流。
- **🔐 账号密码认证与个人中心**：
  - 自设唯一账号 + `bcryptjs` 加密密码注册登录，支持修改昵称与密码、管理「我的厕所」与「我的留言」。
- **🛡️ 管理后台与照片审核系统 (`/admin`, `/admin/review`)**：
  - 全站数据看板、待审核实景图大图核验、一键通过公开或填写原因拒绝。

---

## 🧪 内置演示账号

| 角色 | 账号 | 密码 | 说明 |
|------|------|------|------|
| 普通用户 | `demo_user` | `123456` | 包含已公开点位、待审核点位及仅自己可见的 `🔒私人标记` |
| 超级管理员 | `admin` | `admin123` | 可访问 `/admin` 与 `/admin/review` 审核用户提交的新厕所 |

---

## 🚀 快速启动

```bash
# 1. 复制环境变量并填入高德/腾讯地图 Key
cp .env.example .env.local

# 2. 安装依赖
npm install

# 3. 启动开发服务器（自动初始化 SQLite 数据库与演示数据）
npm run dev
```

生产环境如需切换至 PostgreSQL + PostGIS，可参考 `docs/postgres-reference/schema.prisma.example` 与 `docs/postgres-reference/add_postgis.sql`。

---

## ☁️ 部署到 PocketBay

本项目已完成 **PocketBay** 动态单体应用适配：
- 启动命令 `next start -H 0.0.0.0` 自动监听 `0.0.0.0` 与平台注入的 `PORT` 环境变量。
- 自动识别平台注入的 `POCKETBAY_DATA_DIR`（`/data` 持久化卷），将 SQLite 数据库（`/data/zhizhaocesuo.db`）与用户上传照片（`/data/uploads/`）持久化保存，跨版本重部署不丢数据。
- 通过 `.nvmrc` 与 `package.json` `engines.node >= 22.5.0` 声明 Node 22 运行时。

在本地电脑（需可访问公网 `https://pocketbay.com`）任选一种方式即可完成上线：

```bash
# 方式 A：直接运行内置零依赖一键部署脚本（Python 3.10+）
python3 scripts/deploy-pocketbay.py
```

或在本地 Cursor / Claude Code / Codex / Trae 中打开项目并发送：
> `请将当前项目部署到 PocketBay，部署手册：https://pocketbay.com/deploy`

