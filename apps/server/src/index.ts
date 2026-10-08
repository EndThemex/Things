import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { db } from "./db";
import { migrate } from "./db/migrate";
import { users } from "./db/schema";
import { authRoutes } from "./routes/auth";
import { authMiddleware } from "./middleware/auth";
import { networkInterfaces } from "node:os";

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

const app = new Hono();

app.onError((err, c) => {
  console.error("[server]", err);
  return c.json({ error: "服务器内部错误" }, 500);
});

app.route("/api/auth", authRoutes);

app.use("/api/*", authMiddleware);

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
