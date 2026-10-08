import { Hono } from "hono";
import { z } from "zod";
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  categories,
  componentTags,
  components,
  planItems,
  plans,
  stockMovements,
  tags,
} from "../db/schema";
import { normalizePrice } from "../services/price";
import { ensureTagIds } from "./tags";

export const backupRoutes = new Hono();

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

// ---------- JSON 全量备份导出 ----------

backupRoutes.get("/export", async (c) => {
  const [cats, tgs, comps, compTags, plns, pItems, moves] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.id)),
    db.select().from(tags).orderBy(asc(tags.id)),
    db.select().from(components).orderBy(asc(components.id)),
    db.select().from(componentTags),
    db.select().from(plans).orderBy(asc(plans.id)),
    db.select().from(planItems).orderBy(asc(planItems.id)),
    db.select().from(stockMovements).orderBy(asc(stockMovements.id)),
  ]);
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      categories: cats,
      tags: tgs,
      components: comps,
      componentTags: compTags,
      plans: plns,
      planItems: pItems,
      stockMovements: moves,
    },
  };
  return c.body(JSON.stringify(payload), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="things-backup-${stamp()}.json"`,
  });
});

// ---------- JSON 备份导入恢复（覆盖全部业务数据，保留账号） ----------

const nullableText = z.string().nullable();
const rowId = z.number().int();

const importSchema = z.object({
  version: z.literal(1, { message: "不支持的备份版本" }),
  data: z.object({
    categories: z
      .array(z.object({ id: rowId, name: z.string(), sortOrder: z.number().int().default(0), createdAt: z.string() }))
      .default([]),
    tags: z.array(z.object({ id: rowId, name: z.string() })).default([]),
    components: z
      .array(
        z.object({
          id: rowId,
          name: z.string(),
          categoryId: z.number().int().nullable(),
          quantity: z.number().int().min(0),
          spec: nullableText,
          price: nullableText,
          color: nullableText,
          purchaseUrl: nullableText,
          imagePath: nullableText,
          note: nullableText,
          createdAt: z.string(),
          updatedAt: z.string(),
          deletedAt: nullableText,
        }),
      )
      .default([]),
    componentTags: z.array(z.object({ componentId: rowId, tagId: rowId })).default([]),
    plans: z
      .array(z.object({ id: rowId, name: z.string(), description: nullableText, createdAt: z.string(), updatedAt: z.string() }))
      .default([]),
    planItems: z
      .array(z.object({ id: rowId, planId: rowId, componentId: rowId, quantityPer: z.number().int().min(1) }))
      .default([]),
    stockMovements: z
      .array(
        z.object({
          id: rowId,
          componentId: rowId,
          delta: z.number().int(),
          reason: nullableText,
          planId: z.number().int().nullable(),
          createdAt: z.string(),
        }),
      )
      .default([]),
  }),
});

backupRoutes.post("/import", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: `备份文件格式错误：${parsed.error.issues[0]?.message ?? "参数错误"}` }, 400);
  }
  const d = parsed.data.data;

  try {
    db.transaction((tx) => {
      // 清空业务数据（保留 users 账号与 schema_migrations）
      tx.delete(componentTags).run();
      tx.delete(stockMovements).run();
      tx.delete(planItems).run();
      tx.delete(plans).run();
      tx.delete(components).run();
      tx.delete(tags).run();
      tx.delete(categories).run();

      if (d.categories.length > 0) tx.insert(categories).values(d.categories).run();
      if (d.tags.length > 0) tx.insert(tags).values(d.tags).run();
      if (d.components.length > 0) tx.insert(components).values(d.components).run();
      if (d.componentTags.length > 0) tx.insert(componentTags).values(d.componentTags).run();
      if (d.plans.length > 0) tx.insert(plans).values(d.plans).run();
      if (d.planItems.length > 0) tx.insert(planItems).values(d.planItems).run();
      if (d.stockMovements.length > 0) tx.insert(stockMovements).values(d.stockMovements).run();
    });
  } catch (err) {
    console.error("[backup] JSON 导入失败", err);
    return c.json({ error: "导入失败，已回滚，原数据未改动" }, 400);
  }
  return c.json({
    ok: true,
    counts: {
      categories: d.categories.length,
      tags: d.tags.length,
      components: d.components.length,
      plans: d.plans.length,
    },
  });
});

// ---------- CSV 元件导出（UTF-8 BOM，表头即模板） ----------

const CSV_HEADER = ["名称", "类型", "数量", "规格", "单价", "颜色", "购买链接", "标签", "备注"];

const csvEsc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

backupRoutes.get("/export/csv", async (c) => {
  const rows = await db
    .select({
      id: components.id,
      name: components.name,
      categoryName: categories.name,
      quantity: components.quantity,
      spec: components.spec,
      price: components.price,
      color: components.color,
      purchaseUrl: components.purchaseUrl,
      note: components.note,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(isNull(components.deletedAt))
    .orderBy(asc(components.id));

  const links = await db
    .select({ componentId: componentTags.componentId, name: tags.name })
    .from(componentTags)
    .innerJoin(tags, eq(tags.id, componentTags.tagId));
  const tagMap = new Map<number, string[]>();
  for (const l of links) {
    const list = tagMap.get(l.componentId) ?? [];
    list.push(l.name);
    tagMap.set(l.componentId, list);
  }

  // 仅导出未删除元件，回收站数据通过 JSON 备份保留
  const lines = [CSV_HEADER.map(csvEsc).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.categoryName ?? "",
        r.quantity,
        r.spec ?? "",
        r.price ?? "",
        r.color ?? "",
        r.purchaseUrl ?? "",
        (tagMap.get(r.id) ?? []).join("、"),
        r.note ?? "",
      ]
        .map(csvEsc)
        .join(","),
    );
  }
  const content = "\uFEFF" + lines.join("\r\n");
  return c.body(content, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="components-${stamp()}.csv"`,
  });
});

// ---------- CSV 批量导入（按表头字段名自动识别，无需模板） ----------

/** 常见表头别名 → 标准字段 */
const HEADER_ALIASES: Record<string, string> = {
  名称: "name",
  品名: "name",
  name: "name",
  类型: "category",
  分类: "category",
  category: "category",
  数量: "quantity",
  库存: "quantity",
  quantity: "quantity",
  规格: "spec",
  spec: "spec",
  价格: "price",
  单价: "price",
  "单价(元)": "price",
  price: "price",
  颜色: "color",
  color: "color",
  购买链接: "purchaseUrl",
  链接: "purchaseUrl",
  url: "purchaseUrl",
  颜色链接: "purchaseUrl",
  标签: "tags",
  tags: "tags",
  备注: "note",
  note: "note",
};

/** 解析 CSV 文本为二维数组（支持引号包裹、双引号转义、CRLF） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

backupRoutes.post("/import/csv", async (c) => {
  const body = await c.req.parseBody().catch(() => null);
  const file = body?.["file"];
  if (!(file instanceof File)) return c.json({ error: "缺少 CSV 文件" }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: "文件不能超过 10MB" }, 400);

  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  const rows = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (rows.length < 2) return c.json({ error: "CSV 中没有数据行" }, 400);

  // 表头映射（自动识别，无需模板）
  const colMap = new Map<string, number>();
  rows[0]!.forEach((h, i) => {
    const field = HEADER_ALIASES[h.trim().toLowerCase()] ?? HEADER_ALIASES[h.trim()];
    if (field && !colMap.has(field)) colMap.set(field, i);
  });
  if (!colMap.has("name")) return c.json({ error: "缺少「名称」列（表头须包含名称/品名）" }, 400);

  const get = (row: string[], field: string) => {
    const idx = colMap.get(field);
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };

  // 预加载现有未删除元件的「名称+规格」用于重复识别
  const existing = await db
    .select({ name: components.name, spec: components.spec })
    .from(components)
    .where(isNull(components.deletedAt));
  const seen = new Set(existing.map((r) => `${r.name}__${r.spec ?? ""}`));

  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const lineNo = i + 1;
    const name = get(row, "name");
    if (!name) {
      failed++;
      errors.push(`第 ${lineNo} 行缺少名称，已跳过`);
      continue;
    }
    const spec = get(row, "spec") || null;
    const key = `${name}__${spec ?? ""}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }

    try {
      const qtyRaw = get(row, "quantity");
      const quantity = /^\d+$/.test(qtyRaw) ? Number(qtyRaw) : 0;
      const price = normalizePrice(get(row, "price"));

      // 分类不存在则自动创建
      const catName = get(row, "category");
      let categoryId: number | null = null;
      if (catName) {
        const [found] = await db.select({ id: categories.id }).from(categories).where(eq(categories.name, catName)).limit(1);
        if (found) categoryId = found.id;
        else {
          const [made] = await db
            .insert(categories)
            .values({ name: catName, sortOrder: 0, createdAt: now })
            .returning();
          categoryId = made!.id;
        }
      }

      const [comp] = await db
        .insert(components)
        .values({
          name,
          categoryId,
          quantity,
          spec,
          price,
          color: get(row, "color") || null,
          purchaseUrl: get(row, "purchaseUrl") || null,
          imagePath: null,
          note: get(row, "note") || null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .returning();

      if (quantity > 0) {
        await db
          .insert(stockMovements)
          .values({ componentId: comp!.id, delta: quantity, reason: "CSV 导入", createdAt: now })
          .run();
      }

      // 标签不存在则自动创建
      const tagNames = get(row, "tags")
        .split(/[;；,，、|｜]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (tagNames.length > 0) {
        const tagIds = await ensureTagIds(tagNames);
        if (tagIds.length > 0) {
          await db
            .insert(componentTags)
            .values(tagIds.map((tagId) => ({ componentId: comp!.id, tagId })))
            .run();
        }
      }

      seen.add(key);
      created++;
    } catch (err) {
      failed++;
      errors.push(`第 ${lineNo} 行「${name}」导入失败`);
      console.error(`[backup] CSV 第 ${lineNo} 行导入失败`, err);
    }
  }

  return c.json({ created, skipped, failed, errors: errors.slice(0, 20) });
});
