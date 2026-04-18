import { describe, expect, it } from "vitest";
import zh from "../zh";

describe("zh spec board copy", () => {
  it("includes the spec relationship labels used by the workspace spec page", () => {
    expect(zh.specBoard.description).toContain("本地 issue 记忆层");
    expect(zh.specBoard.status).toBe("状态");
    expect(zh.specBoard.githubLinked).toBe("已关联 GitHub");
    expect(zh.specBoard.connectedIssues).toBe("已连接问题");
    expect(zh.specBoard.families).toBe("关系簇");
    expect(zh.specBoard.featureFootprint).toBe("影响面");
    expect(zh.specBoard.expandBranch).toBe("展开分支");
    expect(zh.specBoard.issueLinks).toBe("关联 Issue");
    expect(zh.specBoard.linkedFrom).toBe("被这些 Issue 引用");
    expect(zh.specBoard.noLinkedIssues).toBe("当前没有记录关联 issue。");
    expect(zh.specBoard.noBacklinks).toBe("目前还没有其它 issue 指向这里。");
  });
});
