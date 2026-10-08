/**
 * 方案核心计算（可行份数、缺料、总价，含单测）。
 * 约定：数量为整数；quantity_per > 0；单价为元（number 或 null）；金额四舍五入到分。
 * 回收站（软删除）元件不参与方案计算，由调用方过滤。
 */
import { round2 } from "./price";

export interface PlanCalcItem {
  componentId: number;
  /** 单份用量（> 0） */
  quantityPer: number;
  /** 当前可用库存（>= 0） */
  quantity: number;
  /** 单价（元），无价视为 0 参与金额汇总 */
  price: number | null;
  name?: string;
  purchaseUrl?: string | null;
}

export interface PlanCalcRow extends PlanCalcItem {
  /** 目标份数所需数量 = quantityPer × copies */
  need: number;
  /** 缺少量 = max(0, need - quantity) */
  shortage: number;
}

export interface PlanCalcResult {
  /** 当前可行份数；无明细时为 null */
  feasible: number | null;
  /** 全部明细（按传入顺序） */
  rows: PlanCalcRow[];
  /** 缺料清单（shortage > 0，按缺少量降序） */
  shortages: PlanCalcRow[];
  /** 1 份总价 */
  totalCost1: number;
  /** 目标份数总价 */
  totalCostCopies: number;
  /** 缺料补齐预估花费 */
  shortageCost: number;
}

/** 可行份数 = min(floor(库存 ÷ 单份用量))，对方案中所有元件取最小值 */
export function calcFeasibleCopies(items: PlanCalcItem[]): number | null {
  if (items.length === 0) return null;
  let min = Infinity;
  for (const it of items) {
    const f = Math.floor(it.quantity / it.quantityPer);
    if (f < min) min = f;
  }
  return min;
}

export function calcPlan(items: PlanCalcItem[], copies: number): PlanCalcResult {
  const rows: PlanCalcRow[] = items.map((it) => {
    const need = it.quantityPer * copies;
    return { ...it, need, shortage: Math.max(0, need - it.quantity) };
  });
  const shortages = rows.filter((r) => r.shortage > 0).sort((a, b) => b.shortage - a.shortage);
  return {
    feasible: calcFeasibleCopies(items),
    rows,
    shortages,
    totalCost1: round2(items.reduce((s, it) => s + it.quantityPer * (it.price ?? 0), 0)),
    totalCostCopies: round2(rows.reduce((s, r) => s + r.need * (r.price ?? 0), 0)),
    shortageCost: round2(shortages.reduce((s, r) => s + r.shortage * (r.price ?? 0), 0)),
  };
}
