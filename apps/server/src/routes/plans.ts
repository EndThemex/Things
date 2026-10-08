import { Hono } from "hono";
import { z } from "zod";
import { asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { categories, components, planItems, plans, stockMovements } from "../db/schema";
import { calcFeasibleCopies, calcPlan, type PlanCalcItem } from "../services/plan";
import { round2 } from "../services/price";

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

/** 校验元件存在，返回去重后的 id 列表；缺失时返回 null */
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

  // 一次取全部明细（仅关联未删除元件，回收站元件不参与方案计算）
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
        shortageCount: rows.filter((r) => r.quantityPer > r.quantity).length, // 目标 1 份时的缺料元件数
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
  if (ids === null) return c.json({ error: "存在无效的元件引用" }, 400);

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
    if (ids === null) return c.json({ error: "存在无效的元件引用" }, 400);
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
    if (active.length === 0) return { error: "方案没有可出库的元件明细" as const };
    // 出库前校验全部元件库存充足（事务保证原子扣减）
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

  // 回收站元件不参与方案计算，仅提示
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
