import { Hono } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const uploadRoutes = new Hono();

// 与 index.ts 的 serveStatic({ root: "../../" }) 保持一致（cwd 为 apps/server）
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? resolve(process.cwd(), "../../uploads");

const MAX_SIZE = 5 * 1024 * 1024; // 5MB（前端已压缩，此为兜底）

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

uploadRoutes.post("/", async (c) => {
  const body = await c.req.parseBody().catch(() => null);
  const file = body?.["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "缺少文件" }, 400);
  }
  if (file.size === 0) return c.json({ error: "文件为空" }, 400);
  if (file.size > MAX_SIZE) return c.json({ error: "图片不能超过 5MB" }, 400);

  const ext = (file.name.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? "").toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime || (file.type && !file.type.startsWith("image/"))) {
    return c.json({ error: "仅支持 jpg/png/webp/gif 图片" }, 400);
  }

  const name = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  try {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    writeFileSync(resolve(UPLOADS_DIR, name), Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    console.error("[upload] 写入失败", err);
    return c.json({ error: "图片保存失败" }, 500);
  }
  return c.json({ path: `/uploads/${name}` }, 201);
});
