import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { componentTags, components, tags } from "../db/schema";

const nameSchema = z.string().trim().min(1, "标签不能为空").max(30, "标签过长");

export const tagRoutes = new Hono();

// 标签列表（含未删除元件的引用数）
tagRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      componentCount: sql<number>`count(${components.id})`,
    })
    .from(tags)
    .leftJoin(componentTags, eq(componentTags.tagId, tags.id))
    .leftJoin(
      components,
      and(eq(components.id, componentTags.componentId), isNull(components.deletedAt)),
    )
    .groupBy(tags.id)
    .orderBy(sql`count(${components.id}) desc`, tags.id);
  return c.json({ items: rows });
});

// 创建标签（已存在则直接返回既有标签，便于前端内联录入）
tagRoutes.post("/", async (c) => {
  const parsed = z.object({ name: nameSchema }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  const name = parsed.data.name;
  const [existing] = await db.select().from(tags).where(sql`${tags.name} = ${name}`).limit(1);
  if (existing) return c.json({ item: existing });
  const [row] = await db.insert(tags).values({ name }).returning();
  return c.json({ item: row }, 201);
});

// 删除标签：元件-标签关联由数据库 ON DELETE CASCADE 一并清除
tagRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const [row] = await db.delete(tags).where(sql`${tags.id} = ${id}`).returning();
  if (!row) return c.json({ error: "标签不存在" }, 404);
  return c.json({ ok: true });
});

// 供元件路由复用：按名称批量取/建标签，返回 id 列表
export async function ensureTagIds(names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const name of names) {
    const [existing] = await db.select().from(tags).where(sql`${tags.name} = ${name}`).limit(1);
    if (existing) {
      ids.push(existing.id);
    } else {
      const [row] = await db.insert(tags).values({ name }).returning();
      ids.push(row.id);
    }
  }
  return ids;
}
