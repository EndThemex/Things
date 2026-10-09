import { Hono } from "hono";
import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, componentTags, components, tags } from "../db/schema";
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

  return c.json({
    summary: {
      kinds: summary.kinds,
      totalQuantity: summary.totalQuantity,
      totalValue: round2(summary.totalValue).toFixed(2),
    },
    categoryDistribution,
    tagDistribution,
    lowStock,
    recent,
  });
});
