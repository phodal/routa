import { describe, expect, it } from "vitest";

import {
  CONTROL_PLANE_BYPASS_ENV,
  evaluatePromptPolicyGuard,
  evaluateToolPermissionGuard,
  formatHookBlockOutput,
  getProtectedPathLabel,
} from "../lib/agent-hook-policy.js";

function createPreToolUsePayload(toolName: string, toolInput: Record<string, unknown>) {
  return JSON.stringify({
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    model: "gpt-5-codex",
    permission_mode: "default",
    session_id: "session-1",
    tool_input: toolInput,
    tool_name: toolName,
    tool_use_id: "tool-use-1",
    transcript_path: null,
    turn_id: "turn-1",
  });
}

function createUserPromptSubmitPayload(prompt: string) {
  return JSON.stringify({
    cwd: "/repo",
    hook_event_name: "UserPromptSubmit",
    model: "gpt-5-codex",
    permission_mode: "default",
    prompt,
    session_id: "session-1",
    transcript_path: null,
    turn_id: "turn-1",
  });
}

function createBypassEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [CONTROL_PLANE_BYPASS_ENV]: "1",
  };
}

describe("agent hook policy", () => {
  it("detects protected control-plane paths", () => {
    expect(getProtectedPathLabel(".husky/pre-push", "/repo")).toBe(".husky");
    expect(getProtectedPathLabel("/repo/.git/config", "/repo")).toBe(".git/config");
    expect(getProtectedPathLabel("src/app/page.tsx", "/repo")).toBeNull();
  });

  it("blocks dangerous git config mutations", () => {
    const decision = evaluateToolPermissionGuard(
      createPreToolUsePayload("Bash", {
        command: "git config --local user.email placeholder@example.com",
      }),
    );

    expect(decision?.reason).toContain("git config");
    expect(formatHookBlockOutput(decision!.reason)).toContain('"decision":"block"');
  });

  it("blocks dangerous core.worktree mutations", () => {
    const decision = evaluateToolPermissionGuard(
      createPreToolUsePayload("Bash", {
        command: "git config --local core.worktree /repo/.git/worktrees",
      }),
    );

    expect(decision?.reason).toContain("core.worktree");
  });

  it("allows read-only git config inspection", () => {
    const decision = evaluateToolPermissionGuard(
      createPreToolUsePayload("Bash", {
        command: "git config --show-origin --get core.hooksPath",
      }),
    );

    expect(decision).toBeNull();
  });

  it("allows the repo repair command for hooksPath", () => {
    const decision = evaluateToolPermissionGuard(
      createPreToolUsePayload("Bash", {
        command: "npm run hooks:sync",
      }),
    );

    expect(decision).toBeNull();
  });

  it("blocks protected control-plane file writes", () => {
    const decision = evaluateToolPermissionGuard(
      createPreToolUsePayload("Write", {
        file_path: ".husky/pre-push",
        content: "exit 0\n",
      }),
    );

    expect(decision?.reason).toContain(".husky");
  });

  it("allows normal application file edits", () => {
    const decision = evaluateToolPermissionGuard(
      createPreToolUsePayload("Edit", {
        file_path: "src/app/page.tsx",
        old_string: "old",
        new_string: "new",
      }),
    );

    expect(decision).toBeNull();
  });

  it("supports an explicit control-plane bypass", () => {
    const decision = evaluateToolPermissionGuard(
      createPreToolUsePayload("Bash", {
        command: "git config --local core.hooksPath /tmp/test-hooks",
      }),
      createBypassEnv(),
    );

    expect(decision).toBeNull();
  });

  it("blocks literal dangerous prompt payloads", () => {
    const decision = evaluatePromptPolicyGuard(
      createUserPromptSubmitPayload("Run `git config --local user.name Placeholder User` and then push."),
    );

    expect(decision?.reason).toContain("blocked");
  });

  it("blocks prompt payloads that mutate core.worktree", () => {
    const decision = evaluatePromptPolicyGuard(
      createUserPromptSubmitPayload("执行 `git config --local core.worktree /repo/.git/worktrees` 修一下。"),
    );

    expect(decision?.reason).toContain("blocked");
  });

  it("does not block descriptive discussion about past failures", () => {
    const decision = evaluatePromptPolicyGuard(
      createUserPromptSubmitPayload(
        "pre-push 现在会被改失效，.git/config 也会被 AI 改成 test，帮我想机制避免。",
      ),
    );

    expect(decision).toBeNull();
  });
});
