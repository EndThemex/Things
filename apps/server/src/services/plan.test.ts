import { describe, expect, it } from "bun:test";
import { calcFeasibleCopies, calcPlan, type PlanCalcItem } from "./plan";

const item = (partial: Partial<PlanCalcItem>): PlanCalcItem => ({
  componentId: 1,
  quantityPer: 1,
  quantity: 0,
  price: null,
  ...partial,
});

describe("calcFeasibleCopies 可行份数", () => {
  it("取所有元件的最小值", () => {
    const items = [
      item({ componentId: 1, quantity: 10, quantityPer: 3 }), // floor(10/3) = 3
      item({ componentId: 2, quantity: 7, quantityPer: 2 }), // floor(7/2) = 3
      item({ componentId: 3, quantity: 100, quantityPer: 50 }), // floor(100/50) = 2
    ];
    expect(calcFeasibleCopies(items)).toBe(2);
  });

  it("任一元件库存为 0 时即 0", () => {
    const items = [
      item({ componentId: 1, quantity: 100, quantityPer: 1 }),
      item({ componentId: 2, quantity: 0, quantityPer: 1 }),
    ];
    expect(calcFeasibleCopies(items)).toBe(0);
  });

  it("恰好整除与不足一份", () => {
    expect(calcFeasibleCopies([item({ quantity: 5, quantityPer: 5 })])).toBe(1);
    expect(calcFeasibleCopies([item({ quantity: 4, quantityPer: 5 })])).toBe(0);
  });

  it("无明细返回 null", () => {
    expect(calcFeasibleCopies([])).toBeNull();
  });
});

describe("calcPlan 缺料与总价", () => {
  it("need/shortage 计算与缺料清单排序", () => {
    const items = [
      item({ componentId: 1, name: "轴体", quantityPer: 5, quantity: 63, price: 2 }),
      item({ componentId: 2, name: "键帽", quantityPer: 61, quantity: 40, price: 1.5 }),
      item({ componentId: 3, name: "螺丝", quantityPer: 4, quantity: 100, price: null }),
    ];
    const r = calcPlan(items, 2);
    expect(r.feasible).toBe(0); // floor(40/61) = 0
    expect(r.rows.find((x) => x.componentId === 1)).toMatchObject({ need: 10, shortage: 0 });
    expect(r.rows.find((x) => x.componentId === 2)).toMatchObject({ need: 122, shortage: 82 });
    expect(r.rows.find((x) => x.componentId === 3)).toMatchObject({ need: 8, shortage: 0 });
    expect(r.shortages.map((x) => x.name)).toEqual(["键帽"]); // 仅键帽缺料
  });

  it("缺料清单按缺少量降序", () => {
    const items = [
      item({ componentId: 1, name: "A", quantityPer: 10, quantity: 5, price: 1 }),
      item({ componentId: 2, name: "B", quantityPer: 3, quantity: 1, price: 1 }),
    ];
    const r = calcPlan(items, 1);
    expect(r.shortages.map((x) => x.name)).toEqual(["A", "B"]); // 缺 5 / 缺 2
  });

  it("总价 = Σ 用量×单价，无价按 0，四舍五入到分", () => {
    const items = [
      item({ componentId: 1, quantityPer: 3, quantity: 100, price: 0.1 }),
      item({ componentId: 2, quantityPer: 2, quantity: 100, price: null }),
    ];
    const r = calcPlan(items, 3);
    expect(r.totalCost1).toBe(0.3); // 3×0.1（消除浮点误差）
    expect(r.totalCostCopies).toBe(0.9); // 9×0.1
    expect(r.shortageCost).toBe(0);
  });

  it("缺料补齐预估花费", () => {
    const items = [
      item({ componentId: 1, quantityPer: 61, quantity: 40, price: 1.5 }),
    ];
    const r = calcPlan(items, 1); // 缺 21
    expect(r.shortageCost).toBe(31.5); // 21×1.5
    expect(r.totalCost1).toBe(91.5); // 61×1.5
  });
});
