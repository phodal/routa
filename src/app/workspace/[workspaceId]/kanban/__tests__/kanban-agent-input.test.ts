import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_REFRESH_BURST_DELAYS_MS,
  buildKanbanTaskAgentPrompt,
  scheduleKanbanRefreshBurst,
} from "../kanban-agent-input";

describe("buildKanbanTaskAgentPrompt", () => {
  it("forces the Kanban input flow to stay in backlog planning mode", () => {
    const prompt = buildKanbanTaskAgentPrompt({
      workspaceId: "default",
      boardId: "board-1",
      repoPath: "/tmp/repo",
      agentInput: "echo hello world",
    });

    expect(prompt).toContain("Target column for every created card: backlog");
    expect(prompt).toContain("This flow is backlog planning, not execution.");
    expect(prompt).toContain("Do not create follow-up agents.");
    expect(prompt).toContain("Do not move cards out of backlog.");
    expect(prompt).toContain("You may use Read, Grep, and Glob for limited repo inspection");
    expect(prompt).toContain("Do not create or sync GitHub issues in this flow.");
    expect(prompt).toContain("Do not use GitHub CLI commands such as gh issue create.");
    expect(prompt).toContain("load_feature_tree_context");
    expect(prompt).toContain("confirm_feature_tree_story_context");
    expect(prompt).toContain("If Relevant History Memory is provided");
    expect(prompt).toContain("If Relevant Feature Tree Context is provided");
    expect(prompt).toContain("Only include contextSearchSpec on create_card, decompose_tasks, or update_task after repo inspection or load_feature_tree_context confirms the feature/files");
    expect(prompt).toContain("include an optional `feature_tree` section");
    expect(prompt).toContain("If the request is a single task, create exactly one backlog card and keep the title close to the user's wording.");
    expect(prompt).toContain("Only avoid creating a new card when an exact duplicate already exists");
    expect(prompt).toContain("call create_card with title plus columnId: \"backlog\"");
    expect(prompt).toContain("Pass boardId: board-1 when available");
    expect(prompt).toContain("Do not invent alternate argument names such as \"column\"; prefer \"columnId\"");
    expect(prompt).toContain("exactly one ```yaml code block");
    expect(prompt).toContain("story.version");
    expect(prompt).toContain("Independent, Negotiable, Valuable, Estimable, Small, and Testable");
    expect(prompt).toContain("User request: echo hello world");
  });

  it("builds a Chinese planning prompt when the Kanban language is zh-CN", () => {
    const prompt = buildKanbanTaskAgentPrompt({
      workspaceId: "default",
      boardId: "board-1",
      repoPath: "/tmp/repo",
      agentInput: "创建一个 hello world",
      language: "zh-CN",
    });

    expect(prompt).toContain("你是当前工作区的看板任务代理");
    expect(prompt).toContain("所有新建卡片的目标列：backlog");
    expect(prompt).toContain("不要开始实现工作。");
    expect(prompt).toContain("description 必须包含一个唯一的 ```yaml 代码块");
    expect(prompt).toContain("invest 下必须显式给出 Independent、Negotiable、Valuable、Estimable、Small、Testable 六项");
    expect(prompt).toContain("只有在 repo 检查或 load_feature_tree_context 已确认 feature / 文件线索后");
    expect(prompt).toContain("confirm_feature_tree_story_context");
    expect(prompt).toContain("可选的 `feature_tree` 段");
    expect(prompt).toContain("用户请求：创建一个 hello world");
  });
});

describe("scheduleKanbanRefreshBurst", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a bounded refresh burst", () => {
    const onRefresh = vi.fn();

    scheduleKanbanRefreshBurst(onRefresh);
    vi.advanceTimersByTime(Math.max(...AGENT_REFRESH_BURST_DELAYS_MS) + 1);

    expect(onRefresh).toHaveBeenCalledTimes(AGENT_REFRESH_BURST_DELAYS_MS.length);
  });

  it("cancels pending refreshes when cleaned up", () => {
    const onRefresh = vi.fn();

    const cancel = scheduleKanbanRefreshBurst(onRefresh);
    vi.advanceTimersByTime(AGENT_REFRESH_BURST_DELAYS_MS[0] - 1);
    cancel();
    vi.advanceTimersByTime(Math.max(...AGENT_REFRESH_BURST_DELAYS_MS) + 1);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
