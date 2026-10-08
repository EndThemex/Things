import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { db } from "./db";
import { migrate } from "./db/migrate";
import { users } from "./db/schema";
import { authRoutes } from "./routes/auth";
import { componentRoutes } from "./routes/components";
import { categoryRoutes } from "./routes/categories";
import { tagRoutes } from "./routes/tags";
import { uploadRoutes } from "./routes/upload";
import { statsRoutes } from "./routes/stats";
import { planRoutes } from "./routes/plans";
import { backupRoutes } from "./routes/backup";
import { hardDeleteComponent, TRASH_RETENTION_DAYS } from "./routes/components";
import { authMiddleware } from "./middleware/auth";
import { networkInterfaces } from "node:os";
import { lt } from "drizzle-orm";
import { components } from "./db/schema";

migrate();

// 首次启动：从环境变量播种单用户账号
async function seedUser() {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) return;
  const username = process.env.AUTH_USERNAME ?? "admin";
  const password = process.env.AUTH_PASSWORD ?? "admin123";
  const now = new Date().toISOString();
  await db.insert(users).values({
    username,
    passwordHash: await Bun.password.hash(password),
    createdAt: now,
    updatedAt: now,
  });
  console.warn(`[auth] 已创建初始账号 "${username}"（默认密码，请登录后在设置中修改）`);
}
await seedUser();

// 启动时顺带清理回收站超期元件（软删除超过保留天数则彻底删除）
async function cleanupTrash() {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400000).toISOString();
  const expired = await db
    .select({ id: components.id })
    .from(components)
    .where(lt(components.deletedAt, cutoff));
  let cleaned = 0;
  for (const row of expired) {
    if (hardDeleteComponent(row.id)) cleaned++;
  }
  if (cleaned > 0) console.log(`[trash] 已自动清理 ${cleaned} 个超期回收站元件`);
}
await cleanupTrash();

const app = new Hono();

app.onError((err, c) => {
  console.error("[server]", err);
  return c.json({ error: "服务器内部错误" }, 500);
});

app.route("/api/auth", authRoutes);

app.use("/api/*", authMiddleware);

app.route("/api/components", componentRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/upload", uploadRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/plans", planRoutes);
app.route("/api", backupRoutes);

app.get("/api/health", (c) => c.json({ ok: true }));

// 生产模式：托管前端构建产物与上传图片
app.use("/uploads/*", serveStatic({ root: "../../", rewriteRequestPath: (p) => p.replace(/^\/uploads/, "/uploads") }));
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ path: "../web/dist/index.html" }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

Bun.serve({ port, hostname: host, fetch: app.fetch });

const nets = networkInterfaces();
const lanIps = Object.values(nets)
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n!.address);
console.log(`[server] http://localhost:${port}`);
lanIps.forEach((ip) => console.log(`[server] http://${ip}:${port}  (局域网)`));
