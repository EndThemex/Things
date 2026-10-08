# Things 项目代码规则

元件库存管理系统（个人自用，单用户，家庭内网部署）。

## 技术栈（勿擅自更换）

- **运行时/包管理**：Bun（禁用 npm/yarn/pnpm 命令；依赖用 `bun add`，在对应 workspace 目录执行）
- **Monorepo 结构**：Bun workspaces
  - `apps/web` — React 18 + TypeScript + Vite + Ant Design 5 + TanStack Query + React Router v7
  - `apps/server` — Hono + Drizzle ORM + SQLite（`bun:sqlite`）+ zod
- 单进程同时服务 API 与前端静态文件（生产模式）

## 常用命令

- `bun run dev` — 同时启动前后端开发
- `bun run dev:server` / `bun run dev:web` — 单独启动
- `bun run build` — 构建前端（`tsc -b && vite build`）
- `bun run db:migrate` — 执行数据库迁移

## Monorepo 注意事项

- 新依赖必须加到对应的 `apps/web/package.json` 或 `apps/server/package.json`，不要加到根 package.json
- 跨包引用统一用 `@things/web`、`@things/server` 包名，workspace 协议 `workspace:*`
- 不要在根目录放置业务代码

## 后端规则（apps/server）

- 路由按模块放 `src/routes/`，中间件放 `src/middleware/`，认证相关在 `src/auth/`
- 所有外部输入必须用 zod 校验后再使用
- 数据库 schema 集中在 `src/db/schema.ts`；改动表结构必须新增 Drizzle 迁移，禁止手写 SQL 改库
- 数量字段为整数；单价存两位小数（元）；「数量 + 总价」折算单价 = 总价 ÷ 数量，四舍五入到分
- 密码哈希用 `Bun.password`，认证用 HTTP-Only Cookie + 签名 Session
- 图片上传写入 `uploads/` 目录，数据库只存相对路径
- 元件删除为软删除（回收站，30 天清理），不做物理删除
- 方案可行份数 = min(floor(可用库存 ÷ 单位用量))，取所有元件最小值

## 前端规则（apps/web）

- 页面组件放 `src/pages/`，主题相关在 `src/theme/`，API 调用统一走 `src/api/client.ts`
- 服务端状态一律用 TanStack Query（含缓存失效刷新），不要手写 useEffect 拉数据
- UI 一律用 Ant Design 5 组件，主题切换通过 `theme.darkAlgorithm` / `defaultAlgorithm`，不引入其他 UI 库
- 图片上传前前端压缩：长边 ≤1280px、JPEG 质量 0.8
- 保持 TypeScript 严格模式，禁止 `any`（确需时用 `unknown` + 收窄）

## 明确不做（避免过度设计）

多用户/权限、注册、i18n、实时协同、全文搜索、PWA、SSR、HTTPS（仅内网 HTTP）。

## 其他约定

- 注释、commit message、文档用中文
- 不提交 `.env`、`app.db*`、`uploads/` 等本地数据（见 `.gitignore`）
- 仅对核心计算（可行份数、缺料、单价折算）写单测，其余手测验收
