import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { unlinkSync } from "node:fs";
import { basename, resolve } from "node:path";
import { db } from "../db";
import { categories, componentTags, components, planItems, stockMovements, tags } from "../db/schema";
import { convertUnitPrice, normalizePrice } from "../services/price";
import { UPLOADS_DIR } from "./upload";
import { ensureTagIds } from "./tags";

/** 回收站保留天数 */
export const TRASH_RETENTION_DAYS = 30;

/** 彻底删除元件（连同标签关联、流水、方案明细引用与图片文件） */
export function hardDeleteComponent(id: number): boolean {
  const [row] = db
    .select({ imagePath: components.imagePath })
    .from(components)
    .where(eq(components.id, id))
    .limit(1)
    .all();
  if (!row) return false;
  db.transaction((tx) => {
    tx.delete(componentTags).where(eq(componentTags.componentId, id)).run();
    tx.delete(stockMovements).where(eq(stockMovements.componentId, id)).run();
    // 方案明细中引用该元件的行一并移除（明细展示用 innerJoin，删除后行自然消失）
    tx.delete(planItems).where(eq(planItems.componentId, id)).run();
    tx.delete(components).where(eq(components.id, id)).run();
  });
  if (row.imagePath) {
    // 仅删除 uploads 目录内的文件，防路径穿越
    const file = basename(row.imagePath);
    try {
      unlinkSync(resolve(UPLOADS_DIR, file));
    } catch {
      // 图片文件不存在时忽略
    }
  }
  return true;
}

// ---------- zod schema ----------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `内容过长`)
    .nullish()
    .transform((v) => v || null);

const priceInput = z
  .union([
    z.number().finite().min(0),
    z.string().regex(/^\s*\d+(\.\d{1,2})?\s*$/, "价格格式错误（最多两位小数）"),
  ])
  .nullish()
  .transform((v) => normalizePrice(v ?? null));

const componentSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(100, "名称过长"),
  categoryId: z.number().int().nullish().transform((v) => v ?? null),
  quantity: z.number().int().min(0, "数量不能为负").default(0),
  spec: optionalText(200),
  price: priceInput,
  color: optionalText(50),
  purchaseUrl: optionalText(500),
  imagePath: optionalText(300),
  note: optionalText(2000),
  tags: z
    .array(z.string().trim().min(1).max(30))
    .max(20, "标签过多")
    .optional()
    .default([]),
});

const adjustSchema = z.object({
  delta: z.number().int().refine((v) => v !== 0, "变动数量不能为 0"),
  totalCost: z.number().finite().min(0).optional(),
  reason: z.string().trim().max(100).optional(),
});

const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.coerce.number().int().optional(),
  tagIds: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
        : [],
    ),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["updated_desc", "updated_asc", "name_asc", "quantity_asc", "price_desc"])
    .default("updated_desc"),
});

// ---------- 查询辅助 ----------

/** 排序表达式（price 为 TEXT，需 CAST 为数值排序） */
function orderExpr(sort: z.infer<typeof listQuerySchema>["sort"]) {
  switch (sort) {
    case "updated_asc":
      return [asc(components.updatedAt), asc(components.id)];
    case "name_asc":
      return [asc(components.name), asc(components.id)];
    case "quantity_asc":
      return [asc(components.quantity), asc(components.name)];
    case "price_desc":
      return [sql`cast(${components.price} as real) desc`, asc(components.id)];
    default:
      return [desc(components.updatedAt), desc(components.id)];
  }
}

/** 「数量 + 总价」折算单价时 LIKE 转义 */
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** 构造列表/计数共用的 where 条件（排除回收站元件） */
function buildWhere(query: z.infer<typeof listQuerySchema>) {
  const conds = [isNull(components.deletedAt)];
  if (query.q) {
    const pattern = likePattern(query.q);
    conds.push(
      sql`(${components.name} like ${pattern} escape '\\' or ${components.spec} like ${pattern} escape '\\')`,
    );
  }
  if (query.categoryId !== undefined) {
    conds.push(eq(components.categoryId, query.categoryId));
  }
  if (query.tagIds.length > 0) {
    // 同时拥有所有选中标签（AND 语义）
    conds.push(
      sql`${components.id} in (
        select ct.component_id from component_tags ct
        where ct.tag_id in (${sql.join(
          query.tagIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        group by ct.component_id
        having count(distinct ct.tag_id) = ${query.tagIds.length}
      )`,
    );
  }
  return and(...conds);
}

/** 批量取元件标签 */
async function attachTags(rows: { id: number }[]) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map<number, { id: number; name: string }[]>();
  const links = await db
    .select({ componentId: componentTags.componentId, id: tags.id, name: tags.name })
    .from(componentTags)
    .innerJoin(tags, eq(tags.id, componentTags.tagId))
    .where(inArray(componentTags.componentId, ids));
  const map = new Map<number, { id: number; name: string }[]>();
  for (const l of links) {
    const list = map.get(l.componentId) ?? [];
    list.push({ id: l.id, name: l.name });
    map.set(l.componentId, list);
  }
  return map;
}

export const componentRoutes = new Hono();

// ---------- 列表 ----------

componentRoutes.get("/", async (c) => {
  const parsed = listQuerySchema.safeParse({
    q: c.req.query("q") || undefined,
    categoryId: c.req.query("categoryId") || undefined,
    tagIds: c.req.query("tagIds") || undefined,
    page: c.req.query("page") || undefined,
    pageSize: c.req.query("pageSize") || undefined,
    sort: c.req.query("sort") || undefined,
  });
  if (!parsed.success) return c.json({ error: "参数错误" }, 400);
  const query = parsed.data;
  const where = buildWhere(query);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(components)
    .where(where);

  const rows = await db
    .select({
      id: components.id,
      name: components.name,
      categoryId: components.categoryId,
      categoryName: categories.name,
      quantity: components.quantity,
      spec: components.spec,
      price: components.price,
      color: components.color,
      purchaseUrl: components.purchaseUrl,
      imagePath: components.imagePath,
      note: components.note,
      updatedAt: components.updatedAt,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(where)
    .orderBy(...orderExpr(query.sort))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const tagMap = await attachTags(rows);
  return c.json({
    items: rows.map((r) => ({ ...r, tags: tagMap.get(r.id) ?? [] })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  });
});

// ---------- 回收站列表 ----------

componentRoutes.get("/trash", async (c) => {
  const rows = await db
    .select({
      id: components.id,
      name: components.name,
      categoryName: categories.name,
      quantity: components.quantity,
      spec: components.spec,
      price: components.price,
      imagePath: components.imagePath,
      deletedAt: components.deletedAt,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(isNotNull(components.deletedAt))
    .orderBy(desc(components.deletedAt), desc(components.id));
  const items = rows.map((r) => {
    const elapsedDays = r.deletedAt
      ? Math.floor((Date.now() - new Date(r.deletedAt).getTime()) / 86400000)
      : 0;
    return { ...r, daysLeft: Math.max(0, TRASH_RETENTION_DAYS - elapsedDays) };
  });
  return c.json({ items });
});

// ---------- 还原 ----------

componentRoutes.post("/:id/restore", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const [row] = await db
    .update(components)
    .set({ deletedAt: null, updatedAt: new Date().toISOString() })
    .where(and(eq(components.id, id), isNotNull(components.deletedAt)))
    .returning()
    .all();
  if (!row) return c.json({ error: "元件不在回收站中" }, 404);
  return c.json({ ok: true });
});

// ---------- 彻底删除 ----------

componentRoutes.delete("/:id/hard", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  if (!hardDeleteComponent(id)) return c.json({ error: "元件不存在" }, 404);
  return c.json({ ok: true });
});

// ---------- 库存流水 ----------

componentRoutes.get("/:id/movements", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const items = await db
    .select({
      id: stockMovements.id,
      delta: stockMovements.delta,
      reason: stockMovements.reason,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .where(eq(stockMovements.componentId, id))
    .orderBy(desc(stockMovements.id))
    .limit(50);
  return c.json({ items });
});

// ---------- 新建 ----------

componentRoutes.post("/", async (c) => {
  const parsed = componentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const data = parsed.data;
  const now = new Date().toISOString();

  const created = db.transaction((tx) => {
    const [row] = tx
      .insert(components)
      .values({
        name: data.name,
        categoryId: data.categoryId,
        quantity: data.quantity,
        spec: data.spec,
        price: data.price,
        color: data.color,
        purchaseUrl: data.purchaseUrl,
        imagePath: data.imagePath,
        note: data.note,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    if (data.quantity > 0) {
      tx.insert(stockMovements)
        .values({ componentId: row.id, delta: data.quantity, reason: "初始录入", createdAt: now })
        .run();
    }
    return row;
  });

  const tagIds = await ensureTagIds(data.tags);
  if (tagIds.length > 0) {
    await db
      .insert(componentTags)
      .values(tagIds.map((tagId) => ({ componentId: created.id, tagId })))
      .run();
  }
  return c.json({ id: created.id }, 201);
});

// ---------- 详情 ----------

componentRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);

  const [row] = await db
    .select({
      id: components.id,
      name: components.name,
      categoryId: components.categoryId,
      categoryName: categories.name,
      quantity: components.quantity,
      spec: components.spec,
      price: components.price,
      color: components.color,
      purchaseUrl: components.purchaseUrl,
      imagePath: components.imagePath,
      note: components.note,
      createdAt: components.createdAt,
      updatedAt: components.updatedAt,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(and(eq(components.id, id), isNull(components.deletedAt)))
    .limit(1);
  if (!row) return c.json({ error: "元件不存在" }, 404);

  const tagMap = await attachTags([row]);
  return c.json({ item: { ...row, tags: tagMap.get(row.id) ?? [] } });
});

// ---------- 编辑 ----------

componentRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const parsed = componentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const data = parsed.data;
  const now = new Date().toISOString();

  // 编辑不直接改数量（库存变动走 /quantity 接口并记流水）
  const [row] = await db
    .update(components)
    .set({
      name: data.name,
      categoryId: data.categoryId,
      spec: data.spec,
      price: data.price,
      color: data.color,
      purchaseUrl: data.purchaseUrl,
      imagePath: data.imagePath,
      note: data.note,
      updatedAt: now,
    })
    .where(and(eq(components.id, id), isNull(components.deletedAt)))
    .returning()
    .all();
  if (!row) return c.json({ error: "元件不存在" }, 404);

  const tagIds = await ensureTagIds(data.tags);
  await db.delete(componentTags).where(eq(componentTags.componentId, id)).run();
  if (tagIds.length > 0) {
    await db
      .insert(componentTags)
      .values(tagIds.map((tagId) => ({ componentId: id, tagId })))
      .run();
  }
  return c.json({ ok: true });
});

// ---------- 移入回收站（软删除） ----------

componentRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const now = new Date().toISOString();
  const [row] = await db
    .update(components)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(components.id, id), isNull(components.deletedAt)))
    .returning()
    .all();
  if (!row) return c.json({ error: "元件不存在" }, 404);
  return c.json({ ok: true });
});

// ---------- 快捷库存调整（补货/扣减，写流水） ----------

componentRoutes.patch("/:id/quantity", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const parsed = adjustSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const { delta, totalCost, reason } = parsed.data;
  const now = new Date().toISOString();

  try {
    const updated = db.transaction((tx) => {
      const [row] = tx
        .select()
        .from(components)
        .where(and(eq(components.id, id), isNull(components.deletedAt)))
        .limit(1)
        .all();
      if (!row) return { notFound: true as const };
      const next = row.quantity + delta;
      if (next < 0) return { error: "库存不足" as const };

      // 补货时若填了总价，单价更新为本次采购价（最新价）
      const newPrice =
        delta > 0 && totalCost !== undefined ? convertUnitPrice(totalCost, delta) : null;

      const [updatedRow] = tx
        .update(components)
        .set({
          quantity: next,
          ...(newPrice !== null && { price: newPrice }),
          updatedAt: now,
        })
        .where(eq(components.id, id))
        .returning()
        .all();
      tx.insert(stockMovements)
        .values({
          componentId: id,
          delta,
          reason: reason ?? (delta > 0 ? "补货" : "手动扣减"),
          createdAt: now,
        })
        .run();
      return { quantity: updatedRow.quantity, price: updatedRow.price };
    });

    if ("notFound" in updated) return c.json({ error: "元件不存在" }, 404);
    if ("error" in updated) return c.json({ error: updated.error }, 400);
    return c.json({ ok: true, quantity: updated.quantity, price: updated.price });
  } catch (err) {
    console.error("[components] quantity adjust failed", err);
    return c.json({ error: "库存调整失败" }, 500);
  }
});
