import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, components } from "../db/schema";

const nameSchema = z.string().trim().min(1, "名称不能为空").max(50, "名称过长");

const createSchema = z.object({
  name: nameSchema,
  sortOrder: z.number().int().optional().default(0),
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  sortOrder: z.number().int().optional(),
});

export const categoryRoutes = new Hono();

// 分类列表（含未删除元件的引用数，便于删除前提示影响范围）
categoryRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      componentCount: sql<number>`count(${components.id})`,
    })
    .from(categories)
    .leftJoin(
      components,
      and(eq(components.categoryId, categories.id), isNull(components.deletedAt)),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.id));
  return c.json({ items: rows });
});

categoryRoutes.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  const { name, sortOrder } = parsed.data;
  try {
    const [row] = await db
      .insert(categories)
      .values({ name, sortOrder, createdAt: new Date().toISOString() })
      .returning();
    return c.json({ item: row }, 201);
  } catch {
    return c.json({ error: "分类已存在" }, 409);
  }
});

categoryRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "参数错误" }, 400);
  const { name, sortOrder } = parsed.data;
  if (name === undefined && sortOrder === undefined) {
    return c.json({ error: "没有需要更新的字段" }, 400);
  }
  try {
    const [row] = await db
      .update(categories)
      .set({ ...(name !== undefined && { name }), ...(sortOrder !== undefined && { sortOrder }) })
      .where(eq(categories.id, id))
      .returning();
    if (!row) return c.json({ error: "分类不存在" }, 404);
    return c.json({ item: row });
  } catch {
    return c.json({ error: "分类已存在" }, 409);
  }
});

// 删除分类：引用它的元件 categoryId 由数据库 ON DELETE SET NULL 置空
categoryRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const [row] = await db.delete(categories).where(eq(categories.id, id)).returning();
  if (!row) return c.json({ error: "分类不存在" }, 404);
  return c.json({ ok: true });
});
