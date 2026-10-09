# Things

元件库存管理系统 —— 个人自用，部署在家庭内网的单用户 Web 应用。用于管理电子元件的库存、分类与标签，并支持基于 BOM 表创建「方案」，自动计算可行份数与缺料情况。

## 功能特性

- **元件管理**：元件的增删改查（删除为软删除，进回收站，30 天后清理）、图片上传（前端自动压缩）、库存数量与单价记录
- **分类 / 标签**：自定义分类与标签，支持输入即筛选、输入回车快速创建新分类
- **方案（Plans）**：上传 BOM 表（CSV）自动解析并匹配库存物品，可预览编辑数量与价格后导入；自动计算方案可行份数与缺料清单
- **数据统计**：库存概览仪表盘
- **备份**：数据库备份下载
- **认证**：账号密码登录（HTTP-Only Cookie + 签名 Session），支持明暗主题切换

## 技术栈

- **运行时 / 包管理**：[Bun](https://bun.sh)
- **Monorepo**：Bun Workspaces
  - `apps/web` — React 18 + TypeScript + Vite + Ant Design 5 + TanStack Query + React Router v7
  - `apps/server` — Hono + Drizzle ORM + SQLite（`bun:sqlite`）+ zod
- 生产模式下单进程同时服务 API 与前端静态文件

## 快速开始

### 方式一：一键部署脚本（推荐，Linux）

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本会自动完成：停止旧服务 → 拉取最新代码 → 安装依赖 → 迁移数据库 → 构建前端 → **后台启动**并做健康检查。

账号、端口、会话密钥等直接在 [deploy.sh](deploy.sh) 顶部「配置区」修改即可。更新部署只需再跑一次 `./deploy.sh`，无需手动停服务。

| 命令                | 说明                 |
| ------------------- | -------------------- |
| `./deploy.sh`       | 部署/更新并后台启动  |
| `./deploy.sh stop`  | 停止服务             |
| `./deploy.sh status`| 查看服务运行状态     |

运行时文件：PID 与日志写入 `apps/server/data/things.pid` / `things.log`。

### 方式二：手动部署

环境要求：[Bun](https://bun.sh) v1.2+

```bash
# 1. 配置环境变量（账号、会话密钥、数据库路径等）
cp apps/server/.env.example apps/server/.env
# 按需修改其中的账号与 AUTH_SECRET

# 2. 安装依赖
bun install

# 3. 初始化数据库
bun run db:migrate

# 4. 开发模式（同时启动前后端）
bun run dev

# 或生产模式（构建前端 + 单进程启动）
bun run prod
```

启动后访问 `http://localhost:3000`（端口可在 `.env` 中通过 `PORT` 修改）。

## 常用命令

| 命令                                     | 说明                   |
| ---------------------------------------- | ---------------------- |
| `bun run dev`                            | 同时启动前后端开发服务 |
| `bun run dev:server` / `bun run dev:web` | 单独启动后端 / 前端    |
| `bun run build`                          | 构建前端               |
| `bun run start`                          | 生产模式启动服务       |
| `bun run prod`                           | 构建前端并启动生产服务 |
| `bun run db:migrate`                     | 执行数据库迁移         |

## 项目结构

```
apps/
├── web/     # 前端（React 18 + Vite + Ant Design 5）
│   └── src/
│       ├── pages/       # 页面组件
│       ├── components/  # 业务组件
│       ├── api/         # API 客户端
│       └── theme/       # 主题配置
└── server/  # 后端（Hono + Drizzle + SQLite）
    └── src/
        ├── routes/      # 路由模块
        ├── services/    # 业务逻辑（含核心计算单测）
        ├── db/          # schema 与迁移
        ├── auth/        # 会话认证
        └── middleware/  # 中间件
```

## 核心计算规则

- 单价折算：「数量 + 总价」折算单价 = 总价 ÷ 数量，四舍五入到分
- 方案可行份数 = min(floor(可用库存 ÷ 单位用量))，取所有所需元件的最小值

## 许可证

见 [LICENSE](LICENSE)。
