import { describe, expect, it } from "vitest";
import { zhExtended } from "../zh-extended";

describe("zh-extended kanban runtime fitness copy", () => {
  it("includes the runtime fitness labels added for kanban status feedback", () => {
    expect(zhExtended.kanban.fitnessLoadError).toBe("加载 Runtime Fitness 状态失败");
    expect(zhExtended.kanban.fitnessHardGate).toBe("硬门禁失败");
    expect(zhExtended.kanban.fitnessScoreBlocked).toBe("分数未达标");
  });
});
