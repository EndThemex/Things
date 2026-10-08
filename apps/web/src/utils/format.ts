/** 四舍五入到分（与服务端 services/price.ts 逻辑一致） */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 「数量 + 总价」折算单价，返回两位小数字符串；非法输入返回 null */
export function convertUnitPrice(totalCost: number, quantity: number): string | null {
  if (!Number.isFinite(totalCost) || !Number.isFinite(quantity)) return null;
  if (quantity <= 0 || totalCost < 0) return null;
  return round2(totalCost / quantity).toFixed(2);
}

export function formatMoney(price: string | null | undefined): string {
  return price ? `¥${price}` : "-";
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = sameYear
    ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
