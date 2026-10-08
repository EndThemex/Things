/**
 * 价格计算（核心逻辑，含单测）
 * 约定：单价以元为单位，四舍五入到分，数据库以 TEXT 存两位小数（如 "12.34"）。
 */

/** 四舍五入到分 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 按「数量 + 总价」折算单价：总价 ÷ 数量，四舍五入到分。
 * 返回两位小数字符串（如 "33.33"）；数量 <= 0 或总价非负数时返回 null。
 */
export function convertUnitPrice(totalCost: number, quantity: number): string | null {
  if (!Number.isFinite(totalCost) || !Number.isFinite(quantity)) return null;
  if (quantity <= 0 || totalCost < 0) return null;
  return round2(totalCost / quantity).toFixed(2);
}

/**
 * 规范化价格输入：接受 number 或数字字符串，返回两位小数字符串；非法输入返回 null。
 * （补货时若填了总价，单价更新为本次采购价，即最新价，不做加权平均。）
 */
export function normalizePrice(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const n = typeof input === "string" ? Number(input) : input;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return round2(n).toFixed(2);
}
