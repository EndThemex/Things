import { Hono } from "hono";
import { and, asc, desc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, componentTags, components, stockMovements, tags } from "../db/schema";
import { round2 } from "../services/price";

export const statsRoutes = new Hono();

// 概览统计：物品种类数、总数量、总价值、分类分布、标签分布、低数量 Top10、最近修改
// 均只统计未删除（deleted_at IS NULL）的物品
statsRoutes.get("/overview", async (c) => {
  // 汇总（price 为 TEXT，需 CAST 后参与计算）
  const [summary] = await db
    .select({
      kinds: sql<number>`count(*)`,
      totalQuantity: sql<number>`coalesce(sum(${components.quantity}), 0)`,
      totalValue: sql<number>`coalesce(sum(${components.quantity} * cast(${components.price} as real)), 0)`,
    })
    .from(components)
    .where(isNull(components.deletedAt));

  // 分类数（全量分类，含暂无物品的分类）
  const [catStat] = await db.select({ categoryCount: sql<number>`count(*)` }).from(categories);

  // 零库存物品种类数
  const [zeroStat] = await db
    .select({ zeroStock: sql<number>`count(*)` })
    .from(components)
    .where(and(isNull(components.deletedAt), eq(components.quantity, 0)));

  // 分类分布（含「未分类」桶）
  const categoryRows = await db
    .select({
      id: components.categoryId,
      name: categories.name,
      kinds: sql<number>`count(*)`,
      quantity: sql<number>`coalesce(sum(${components.quantity}), 0)`,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(isNull(components.deletedAt))
    .groupBy(components.categoryId);
  const categoryDistribution = categoryRows
    .map((r) => ({ ...r, name: r.name ?? "未分类" }))
    .sort((a, b) => b.quantity - a.quantity || b.kinds - a.kinds);

  // 标签分布
  const tagDistribution = await db
    .select({
      id: tags.id,
      name: tags.name,
      count: sql<number>`count(${componentTags.componentId})`,
    })
    .from(tags)
    .innerJoin(componentTags, eq(componentTags.tagId, tags.id))
    .innerJoin(components, eq(components.id, componentTags.componentId))
    .where(isNull(components.deletedAt))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${componentTags.componentId})`), asc(tags.id));

  // 数量最少的物品 Top10（便于发现待补货）
  const lowStock = await db
    .select({
      id: components.id,
      name: components.name,
      categoryName: categories.name,
      quantity: components.quantity,
      spec: components.spec,
      price: components.price,
      imagePath: components.imagePath,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(isNull(components.deletedAt))
    .orderBy(asc(components.quantity), asc(components.name))
    .limit(10);

  // 最近修改
  const recent = await db
    .select({
      id: components.id,
      name: components.name,
      categoryName: categories.name,
      quantity: components.quantity,
      price: components.price,
      imagePath: components.imagePath,
      updatedAt: components.updatedAt,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(isNull(components.deletedAt))
    .orderBy(desc(components.updatedAt), desc(components.id))
    .limit(10);

  // 分类价值分布（各分类占用资金，price 为 TEXT 需 CAST，null 归 0）
  const categoryValueRows = await db
    .select({
      id: components.categoryId,
      name: categories.name,
      kinds: sql<number>`count(*)`,
      value: sql<number>`coalesce(sum(${components.quantity} * cast(${components.price} as real)), 0)`,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(isNull(components.deletedAt))
    .groupBy(components.categoryId);
  const categoryValueDistribution = categoryValueRows
    .map((r) => ({ ...r, name: r.name ?? "未分类", value: round2(r.value).toFixed(2) }))
    .sort((a, b) => Number(b.value) - Number(a.value));

  // 库存价值最高 Top10（value > 0 才上榜）
  const valueTop10Rows = await db
    .select({
      id: components.id,
      name: components.name,
      categoryName: categories.name,
      quantity: components.quantity,
      price: components.price,
      imagePath: components.imagePath,
      value: sql<number>`coalesce(${components.quantity} * cast(${components.price} as real), 0)`,
    })
    .from(components)
    .leftJoin(categories, eq(categories.id, components.categoryId))
    .where(and(isNull(components.deletedAt), gt(sql`coalesce(${components.quantity} * cast(${components.price} as real), 0)`, 0)))
    .orderBy(
      sql`coalesce(${components.quantity} * cast(${components.price} as real), 0) desc`,
      asc(components.name),
    )
    .limit(10);
  const valueTop10 = valueTop10Rows.map((r) => ({ ...r, value: round2(r.value).toFixed(2) }));

  // 近 14 天出入库趋势（按 Asia/Shanghai 本地日期分组，created_at 为 UTC ISO 字符串故 +8 小时）
  const dayList: string[] = [];
  const today = new Date();
  const localDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (let i = 13; i >= 0; i--) {
    dayList.push(localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)));
  }
  // 截止点取 13 天前的本地零点（转 ISO 即为对应 UTC 时刻）
  const cutoffIso = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13).toISOString();
  const trendRows = await db
    .select({
      date: sql<string>`date(${stockMovements.createdAt}, '+8 hours')`,
      inbound: sql<number>`coalesce(sum(case when ${stockMovements.delta} > 0 then ${stockMovements.delta} else 0 end), 0)`,
      outbound: sql<number>`coalesce(sum(case when ${stockMovements.delta} < 0 then -${stockMovements.delta} else 0 end), 0)`,
    })
    .from(stockMovements)
    .innerJoin(components, eq(components.id, stockMovements.componentId))
    .where(and(isNull(components.deletedAt), gte(stockMovements.createdAt, cutoffIso)))
    .groupBy(sql`date(${stockMovements.createdAt}, '+8 hours')`);
  const trendMap = new Map(trendRows.map((r) => [r.date, r]));
  const movementTrend = dayList.map((date) => ({
    date,
    inbound: Number(trendMap.get(date)?.inbound ?? 0),
    outbound: Number(trendMap.get(date)?.outbound ?? 0),
  }));

  // 最近出入库流水（回收站物品不展示，保证行内链接可跳转）
  const recentMovements = await db
    .select({
      id: stockMovements.id,
      componentId: stockMovements.componentId,
      componentName: components.name,
      delta: stockMovements.delta,
      reason: stockMovements.reason,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .innerJoin(components, eq(components.id, stockMovements.componentId))
    .where(isNull(components.deletedAt))
    .orderBy(desc(stockMovements.id))
    .limit(10);

  return c.json({
    summary: {
      kinds: summary.kinds,
      totalQuantity: summary.totalQuantity,
      totalValue: round2(summary.totalValue).toFixed(2),
      categoryCount: catStat.categoryCount,
      zeroStock: zeroStat.zeroStock,
    },
    categoryDistribution,
    categoryValueDistribution,
    tagDistribution,
    valueTop10,
    movementTrend,
    recentMovements,
    lowStock,
    recent,
  });
});
