import { describe, expect, it } from "vitest";
import { formatTokens, formatCost } from "./tokenFormat";

describe("formatTokens", () => {
  it("leaves small counts alone", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("switches to K at a thousand and M at a million", () => {
    expect(formatTokens(1_000)).toBe("1.0K");
    expect(formatTokens(50_700)).toBe("50.7K");
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(2_450_000)).toBe("2.5M");
  });
});

describe("formatCost", () => {
  it("keeps four decimals below a dollar", () => {
    // A single turn is often a fraction of a cent; two decimals would render it as $0.00
    // and read as free.
    expect(formatCost(0.0024)).toBe("$0.0024");
    expect(formatCost(0.0000012)).toBe("$0.0000");
  });

  it("drops to two decimals at a dollar and above", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(12.3456)).toBe("$12.35");
  });
});
