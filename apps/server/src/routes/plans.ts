import { Hono } from "hono";
import { z } from "zod";
import { asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { categories, components, planItems, plans, stockMovements } from "../db/schema";
import { calcFeasibleCopies, calcPlan, type PlanCalcItem } from "../services/plan";
import { normalizePrice, round2 } from "../services/price";
import { HEADER_ALIASES, parseCsv } from "./backup";

// ---------- zod schema ----------

const itemSchema = z.object({
  componentId: z.number().int().positive("参数错误"),
  quantityPer: z.number().int().min(1, "单份用量必须为正整数").max(1000000, "单份用量过大"),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(100, "名称过长"),
  description: z.string().trim().max(2000, "描述过长").nullish().transform((v) => v || null),
  items: z.array(itemSchema).max(200, "明细过多").default([]),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(100, "名称过长").optional(),
  description: z.string().trim().max(2000, "描述过长").nullish(),
  items: z.array(itemSchema).max(200, "明细过多").optional(),
});

// ---------- 查询辅助 ----------

/** 校验物品存在，返回去重后的 id 列表；缺失时返回 null */
async function resolveComponentIds(ids: number[]): Promise<number[] | null> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = await db
    .select({ id: components.id })
    .from(components)
    .where(inArray(components.id, unique));
  return found.length === unique.length ? unique : null;
}

/** 金额统一输出为两位小数字符串 */
const money = (n: number) => n.toFixed(2);

export const planRoutes = new Hono();

// ---------- 列表（含每个方案的可行份数摘要） ----------

planRoutes.get("/", async (c) => {
  const planRows = await db
    .select({
      id: plans.id,
      name: plans.name,
      description: plans.description,
      updatedAt: plans.updatedAt,
    })
    .from(plans)
    .orderBy(desc(plans.updatedAt), desc(plans.id));

  // 一次取全部明细（仅关联未删除物品，回收站物品不参与方案计算）
  const itemRows = await db
    .select({
      planId: planItems.planId,
      quantityPer: planItems.quantityPer,
      quantity: components.quantity,
      price: components.price,
    })
    .from(planItems)
    .innerJoin(components, eq(components.id, planItems.componentId))
    .where(isNull(components.deletedAt));

  const grouped = new Map<number, { quantityPer: number; quantity: number; price: string | null }[]>();
  for (const r of itemRows) {
    const list = grouped.get(r.planId) ?? [];
    list.push(r);
    grouped.set(r.planId, list);
  }

  return c.json({
    items: planRows.map((p) => {
      const rows = grouped.get(p.id) ?? [];
      const calcItems: PlanCalcItem[] = rows.map((r) => ({
        componentId: 0,
        quantityPer: r.quantityPer,
        quantity: r.quantity,
        price: r.price === null ? null : Number(r.price),
      }));
      return {
        ...p,
        itemCount: rows.length,
        feasible: calcFeasibleCopies(calcItems),
        totalCost1: money(round2(rows.reduce((s, r) => s + r.quantityPer * (r.price === null ? 0 : Number(r.price)), 0))),
        shortageCount: rows.filter((r) => r.quantityPer > r.quantity).length, // 目标 1 份时的缺料物品数
      };
    }),
  });
});

// ---------- 新建 ----------

planRoutes.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const { name, description, items } = parsed.data;
  const ids = await resolveComponentIds(items.map((i) => i.componentId));
  if (ids === null) return c.json({ error: "存在无效的物品引用" }, 400);

  const now = new Date().toISOString();
  const created = db.transaction((tx) => {
    const [row] = tx
      .insert(plans)
      .values({ name, description, createdAt: now, updatedAt: now })
      .returning()
      .all();
    if (items.length > 0) {
      tx.insert(planItems)
        .values(items.map((i) => ({ planId: row.id, componentId: i.componentId, quantityPer: i.quantityPer })))
        .run();
    }
    return row;
  });
  return c.json({ id: created.id }, 201);
});

// ---------- 详情（含明细） ----------

planRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);

  const [plan] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  if (!plan) return c.json({ error: "方案不存在" }, 404);

  const items = await db
    .select({
      id: planItems.id,
      componentId: components.id,
      name: components.name,
      spec: components.spec,
      categoryName: categories.name,
      quantityPer: planItems.quantityPer,
      quantity: components.quantity,
      price: components.price,
      purchaseUrl: components.purchaseUrl,
      imagePath: components.imagePath,
      deletedAt: components.deletedAt,
    })
    .from(planItems)
    .innerJoin(components, eq(components.id, planItems.componentId))
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(eq(planItems.planId, id))
    .orderBy(asc(planItems.id));

  return c.json({
    item: {
      ...plan,
      items: items.map(({ deletedAt, ...it }) => ({ ...it, inTrash: deletedAt !== null })),
    },
  });
});

// ---------- 编辑（基本信息/明细） ----------

planRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const { name, description, items } = parsed.data;
  if (name === undefined && description === undefined && items === undefined) {
    return c.json({ error: "没有需要更新的字段" }, 400);
  }
  if (items) {
    const ids = await resolveComponentIds(items.map((i) => i.componentId));
    if (ids === null) return c.json({ error: "存在无效的物品引用" }, 400);
  }

  const now = new Date().toISOString();
  const result = db.transaction((tx) => {
    const [row] = tx
      .update(plans)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description: description ?? null }),
        updatedAt: now,
      })
      .where(eq(plans.id, id))
      .returning()
      .all();
    if (!row) return { notFound: true as const };
    if (items) {
      // 整体替换明细
      tx.delete(planItems).where(eq(planItems.planId, id)).run();
      if (items.length > 0) {
        tx.insert(planItems)
          .values(items.map((i) => ({ planId: id, componentId: i.componentId, quantityPer: i.quantityPer })))
          .run();
      }
    }
    return { ok: true as const };
  });
  if ("notFound" in result) return c.json({ error: "方案不存在" }, 404);
  return c.json({ ok: true });
});

// ---------- 删除（物理删除，明细随外键级联；此处显式清理以防外键未启用） ----------

planRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const deleted = db.transaction((tx) => {
    const [row] = tx.delete(plans).where(eq(plans.id, id)).returning().all();
    if (row) tx.delete(planItems).where(eq(planItems.planId, id)).run();
    return row;
  });
  if (!deleted) return c.json({ error: "方案不存在" }, 404);
  return c.json({ ok: true });
});

// ---------- 按方案出库（扣库存并写流水） ----------

const consumeSchema = z.object({
  copies: z.number().int().min(1, "份数必须为正整数").max(10000).default(1),
});

planRoutes.post("/:id/consume", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const parsed = consumeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const { copies } = parsed.data;

  const result = db.transaction((tx) => {
    const [plan] = tx.select().from(plans).where(eq(plans.id, id)).limit(1).all();
    if (!plan) return { notFound: true as const };
    const items = tx
      .select({
        componentId: components.id,
        name: components.name,
        quantityPer: planItems.quantityPer,
        quantity: components.quantity,
        deletedAt: components.deletedAt,
      })
      .from(planItems)
      .innerJoin(components, eq(components.id, planItems.componentId))
      .where(eq(planItems.planId, id))
      .all();
    const active = items.filter((i) => i.deletedAt === null);
    if (active.length === 0) return { error: "方案没有可出库的物品明细" as const };
    // 出库前校验全部物品库存充足（事务保证原子扣减）
    const shortage = active.filter((i) => i.quantity < i.quantityPer * copies);
    if (shortage.length > 0) {
      return {
        error: `库存不足：${shortage
          .map((s) => `${s.name}（缺 ${(s.quantityPer * copies) - s.quantity}）`)
          .join("、")}` as const,
      };
    }
    const now = new Date().toISOString();
    for (const i of active) {
      const need = i.quantityPer * copies;
      tx
        .update(components)
        .set({ quantity: i.quantity - need, updatedAt: now })
        .where(eq(components.id, i.componentId))
        .run();
      tx
        .insert(stockMovements)
        .values({
          componentId: i.componentId,
          delta: -need,
          reason: `方案出库：${plan.name}${copies > 1 ? ` ×${copies}` : ""}`,
          planId: id,
          createdAt: now,
        })
        .run();
    }
    return { deducted: active.length as number };
  });
  if ("notFound" in result) return c.json({ error: "方案不存在" }, 404);
  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json({ ok: true, deducted: result.deducted });
});

// ---------- 可行性计算（核心） ----------

planRoutes.get("/:id/feasibility", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "参数错误" }, 400);
  const copies = z.coerce.number().int().min(1, "目标份数必须为正整数").max(1000000).default(1);
  const parsed = copies.safeParse(c.req.query("copies") || undefined);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);

  const [plan] = await db.select({ id: plans.id, name: plans.name }).from(plans).where(eq(plans.id, id)).limit(1);
  if (!plan) return c.json({ error: "方案不存在" }, 404);

  const rows = await db
    .select({
      componentId: planItems.componentId,
      quantityPer: planItems.quantityPer,
      quantity: components.quantity,
      price: components.price,
      name: components.name,
      purchaseUrl: components.purchaseUrl,
      deletedAt: components.deletedAt,
    })
    .from(planItems)
    .innerJoin(components, eq(components.id, planItems.componentId))
    .where(eq(planItems.planId, id));

  // 回收站物品不参与方案计算，仅提示
  const trashItems = rows.filter((r) => r.deletedAt !== null).map((r) => r.name);
  const calcItems: PlanCalcItem[] = rows
    .filter((r) => r.deletedAt === null)
    .map((r) => ({
      componentId: r.componentId,
      quantityPer: r.quantityPer,
      quantity: r.quantity,
      price: r.price === null ? null : Number(r.price),
      name: r.name,
      purchaseUrl: r.purchaseUrl,
    }));
  const calc = calcPlan(calcItems, parsed.data);

  return c.json({
    copies: parsed.data,
    feasible: calc.feasible,
    totalCost1: money(calc.totalCost1),
    totalCostCopies: money(calc.totalCostCopies),
    shortageCost: money(calc.shortageCost),
    shortages: calc.shortages.map((r) => ({
      componentId: r.componentId,
      name: r.name,
      quantityPer: r.quantityPer,
      quantity: r.quantity,
      need: r.need,
      shortage: r.shortage,
      price: r.price === null ? null : money(r.price),
      purchaseUrl: r.purchaseUrl ?? null,
    })),
    trashItems,
  });
});

// ---------- BOM 导入：CSV 解析预览（不写库） ----------

/** BOM 表头在通用别名基础上的补充映射（「数量」列语义为单份用量，「封装」作为规格） */
const BOM_HEADER_ALIASES: Record<string, string> = {
  ...HEADER_ALIASES,
  用量: "quantity",
  单份用量: "quantity",
  封装: "spec",
  package: "spec",
  footprint: "spec",
};

interface BomPreviewItem {
  name: string;
  spec: string | null;
  /** BOM「分类/类型」列，用于新建缺失物品时设置分类 */
  category: string | null;
  quantityPer: number;
  /** 解析出的单价（两位小数字符串），用于新建缺失物品时填充 */
  price: string | null;
  purchaseUrl: string | null;
  /** 匹配到的现有物品 id；null 表示物品库中不存在，导入时将新建 */
  matchedComponentId: number | null;
  /** 匹配到的现有物品库存；新建行为 null */
  stock: number | null;
}

planRoutes.post("/parse-bom", async (c) => {
  const body = await c.req.parseBody().catch(() => null);
  const file = body?.["file"];
  if (!(file instanceof File)) return c.json({ error: "缺少 CSV 文件" }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: "文件不能超过 10MB" }, 400);

  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  const rows = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (rows.length < 2) return c.json({ error: "CSV 中没有数据行" }, 400);

  // 表头映射（自动识别，与物品 CSV 导入共用别名，无需模板）
  const colMap = new Map<string, number>();
  rows[0]!.forEach((h, i) => {
    const field = BOM_HEADER_ALIASES[h.trim().toLowerCase()] ?? BOM_HEADER_ALIASES[h.trim()];
    if (field && !colMap.has(field)) colMap.set(field, i);
  });
  if (!colMap.has("name")) return c.json({ error: "缺少「名称」列（表头须包含名称/品名）" }, 400);

  const get = (row: string[], field: string) => {
    const idx = colMap.get(field);
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };

  // 预加载现有未删除物品，按「名称+规格」匹配（与物品 CSV 导入口径一致）
  const existing = await db
    .select({ id: components.id, name: components.name, spec: components.spec, quantity: components.quantity })
    .from(components)
    .where(isNull(components.deletedAt));
  const compMap = new Map(existing.map((r) => [`${r.name}__${r.spec ?? ""}`, r]));

  const warnings: string[] = [];
  // BOM 内同名同规格行合并累加单份用量
  const merged = new Map<string, BomPreviewItem>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const lineNo = i + 1;
    const name = get(row, "name");
    if (!name) {
      warnings.push(`第 ${lineNo} 行缺少名称，已跳过`);
      continue;
    }
    if (merged.size >= 200) {
      warnings.push("明细超过 200 行，超出部分已忽略");
      break;
    }
    const spec = get(row, "spec") || null;
    const key = `${name}__${spec ?? ""}`;

    // 单份用量：须为正整数，空/无效时按 1 处理
    const qtyRaw = get(row, "quantity");
    let quantityPer = /^\d+$/.test(qtyRaw) ? Number(qtyRaw) : 0;
    if (quantityPer < 1) {
      if (qtyRaw) warnings.push(`第 ${lineNo} 行「${name}」数量「${qtyRaw}」无效，已按 1 处理`);
      quantityPer = 1;
    }

    const priceRaw = get(row, "price");
    const price = normalizePrice(priceRaw);
    if (priceRaw && price === null) {
      warnings.push(`第 ${lineNo} 行「${name}」价格「${priceRaw}」格式无效，已忽略`);
    }
    const purchaseUrl = get(row, "purchaseUrl") || null;
    const category = get(row, "category") || null;

    const prev = merged.get(key);
    if (prev) {
      prev.quantityPer += quantityPer;
      warnings.push(`第 ${lineNo} 行与前面「${name}」重复，单份用量已合并累加`);
      if (price !== null && prev.price === null) prev.price = price;
      if (purchaseUrl && !prev.purchaseUrl) prev.purchaseUrl = purchaseUrl;
      if (category && !prev.category) prev.category = category;
      continue;
    }

    const matched = compMap.get(key) ?? null;
    merged.set(key, {
      name,
      spec,
      category,
      quantityPer,
      price,
      purchaseUrl,
      matchedComponentId: matched?.id ?? null,
      stock: matched?.quantity ?? null,
    });
  }

  return c.json({ items: [...merged.values()], warnings: warnings.slice(0, 50) });
});

// ---------- BOM 导入：确认提交（事务创建缺失物品 + 方案） ----------

const bomImportSchema = z.object({
  name: z.string().trim().min(1, "方案名称不能为空").max(100, "方案名称过长"),
  description: z.string().trim().max(2000, "描述过长").nullish().transform((v) => v || null),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, "名称不能为空").max(100, "名称过长"),
        spec: z.string().trim().max(200, "规格过长").nullish().transform((v) => v || null),
        /** 仅新建缺失物品时生效：分类不存在则自动创建 */
        category: z.string().trim().max(50, "分类过长").nullish().transform((v) => v || null),
        quantityPer: z.number().int().min(1, "单份用量必须为正整数").max(1000000, "单份用量过大"),
        /** 仅新建缺失物品时作为初始库存，默认 0（空） */
        stock: z.number().int().min(0, "库存不能为负").max(1000000, "库存过大").default(0),
        price: z.number().finite().min(0, "价格不能为负").nullish(),
        purchaseUrl: z.string().trim().max(500, "链接过长").nullish().transform((v) => v || null),
      }),
    )
    .min(1, "至少需要一行明细")
    .max(200, "明细过多"),
});

planRoutes.post("/import-bom", async (c) => {
  const parsed = bomImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const { name, description, items } = parsed.data;

  const now = new Date().toISOString();
  const result = db.transaction((tx) => {
    // 方案内「名称+规格」→ 物品 id（含现有物品与本事务新建的物品）
    const resolved = new Map<string, number>();
    const existingRows = tx
      .select({ id: components.id, name: components.name, spec: components.spec })
      .from(components)
      .where(isNull(components.deletedAt))
      .all();
    for (const r of existingRows) resolved.set(`${r.name}__${r.spec ?? ""}`, r.id);

    // 分类缓存（名称 → id，含本事务新建的分类）
    const categoryCache = new Map<string, number>();
    for (const cat of tx.select({ id: categories.id, name: categories.name }).from(categories).all()) {
      categoryCache.set(cat.name, cat.id);
    }
    const resolveCategoryId = (name: string): number => {
      let id = categoryCache.get(name);
      if (id === undefined) {
        const [made] = tx
          .insert(categories)
          .values({ name, sortOrder: 0, createdAt: now })
          .returning()
          .all();
        id = made!.id;
        categoryCache.set(name, id);
      }
      return id;
    };

    // 按 componentId 合并用量（BOM 内同名同规格行最终落到同一物品）
    const usage = new Map<number, number>();
    let createdComponents = 0;

    for (const item of items) {
      const key = `${item.name}__${item.spec ?? ""}`;
      let componentId = resolved.get(key);
      if (componentId === undefined) {
        const price = item.price === null || item.price === undefined ? null : round2(item.price).toFixed(2);
        const [comp] = tx
          .insert(components)
          .values({
            name: item.name,
            categoryId: item.category ? resolveCategoryId(item.category) : null,
            quantity: item.stock,
            spec: item.spec,
            price,
            purchaseUrl: item.purchaseUrl,
            imagePath: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .all();
        componentId = comp!.id;
        if (item.stock > 0) {
          tx
            .insert(stockMovements)
            .values({ componentId, delta: item.stock, reason: "BOM 导入", createdAt: now })
            .run();
        }
        resolved.set(key, componentId);
        createdComponents++;
      }
      usage.set(componentId, (usage.get(componentId) ?? 0) + item.quantityPer);
    }

    const [plan] = tx
      .insert(plans)
      .values({ name, description, createdAt: now, updatedAt: now })
      .returning()
      .all();
    tx
      .insert(planItems)
      .values([...usage.entries()].map(([componentId, quantityPer]) => ({ planId: plan!.id, componentId, quantityPer })))
      .run();

    return { planId: plan!.id, createdComponents };
  });

  return c.json({ id: result.planId, createdComponents: result.createdComponents }, 201);
});
