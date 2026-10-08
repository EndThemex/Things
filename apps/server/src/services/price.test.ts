import { describe, expect, it } from "bun:test";
import { convertUnitPrice, normalizePrice, round2 } from "./price";

describe("convertUnitPrice 单价折算", () => {
  it("总价÷数量 四舍五入到分", () => {
    expect(convertUnitPrice(100, 3)).toBe("33.33");
    expect(convertUnitPrice(10, 3)).toBe("3.33");
    expect(convertUnitPrice(1, 8)).toBe("0.13"); // 0.125 → 0.13
    expect(convertUnitPrice(0.615, 1)).toBe("0.62"); // 浮点误差向上取
    expect(convertUnitPrice(33, 10)).toBe("3.30");
  });

  it("整除结果保留两位", () => {
    expect(convertUnitPrice(50, 25)).toBe("2.00");
    expect(convertUnitPrice(0, 5)).toBe("0.00");
  });

  it("非法输入返回 null", () => {
    expect(convertUnitPrice(10, 0)).toBeNull();
    expect(convertUnitPrice(10, -2)).toBeNull();
    expect(convertUnitPrice(-1, 2)).toBeNull();
    expect(convertUnitPrice(NaN, 2)).toBeNull();
    expect(convertUnitPrice(Infinity, 2)).toBeNull();
  });
});

describe("normalizePrice 价格规范化", () => {
  it("接受数字与字符串，输出两位小数", () => {
    expect(normalizePrice(12.3)).toBe("12.30");
    expect(normalizePrice("12.345")).toBe("12.35"); // 超出两位则四舍五入
    expect(normalizePrice("0.1")).toBe("0.10");
    expect(normalizePrice(8)).toBe("8.00");
    expect(normalizePrice("  3.5 ")).toBe("3.50"); // 容忍首尾空白
  });

  it("空值与非法输入返回 null", () => {
    expect(normalizePrice(null)).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
    expect(normalizePrice("")).toBeNull();
    expect(normalizePrice("abc")).toBeNull();
    expect(normalizePrice(-5)).toBeNull();
  });
});

describe("round2", () => {
  it("经典浮点误差场景", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });
});
