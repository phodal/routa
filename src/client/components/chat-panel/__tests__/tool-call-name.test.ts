import { describe, expect, it } from "vitest";
import { processHistoryToMessages, processUpdate } from "../hooks/message-processor";
import { getToolEventLabel, getToolEventName } from "../tool-call-name";
import type { ChatMessage } from "../types";

describe("getToolEventName", () => {
  it("prefers explicit tool names from Codex-style events", () => {
    expect(getToolEventName({
      tool: "update_card",
      title: "tool",
      kind: "unknown",
    })).toBe("update_card");
  });

  it("falls back through toolName, title, and kind", () => {
    expect(getToolEventLabel({ toolName: "delegate_task_to_agent" })).toBe("delegate_task_to_agent");
    expect(getToolEventLabel({ title: "read_file" })).toBe("read_file");
    expect(getToolEventLabel({ kind: "shell" })).toBe("shell");
    expect(getToolEventLabel({})).toBe("tool");
  });

  it("uses the command when the provider title is an opaque call id", () => {
    expect(getToolEventLabel({
      title: "call_BCby6Zam4yfgIY78O9x3vYOH",
      kind: "shell",
      rawInput: { command: "rg -n \"foo\" src/app/api" },
    })).toBe("rg -n \"foo\" src/app/api");
  });
});

describe("message-processor tool names", () => {
  const codexToolEvent = {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    tool: "update_card",
    server: "routa-coordination",
    status: "running",
    rawInput: {
      cardId: "8b1e7b4f-f92b-4898-a523-42d7c5dfbd19",
      description: "Updated description",
    },
  };

  it("keeps explicit tool names when processing history", () => {
    const messages = processHistoryToMessages([{ sessionId: "session-1", update: codexToolEvent }], "session-1");

    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolName).toBe("update_card");
  });

  it("keeps explicit tool names during live updates", () => {
    const messages: ChatMessage[] = [];

    processUpdate(
      "tool_call",
      codexToolEvent,
      messages,
      "session-1",
      null,
      () => "",
      { current: {} },
      { current: {} },
      () => undefined,
      () => undefined,
      () => undefined,
      {}
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolName).toBe("update_card");
    expect(messages[0]?.content).toContain("cardId");
  });

  it("preserves permission request input when the approval response arrives", () => {
    const messages: ChatMessage[] = [];

    processUpdate(
      "tool_call",
      {
        sessionUpdate: "tool_call",
        toolCallId: "request-permission-1",
        title: "RequestPermissions",
        kind: "request-permissions",
        status: "waiting",
        rawInput: {
          reason: "Need write access outside workspace",
          permissions: {
            file_system: {
              write: ["/tmp/outside"],
            },
          },
        },
      },
      messages,
      "session-1",
      null,
      () => "",
      { current: {} },
      { current: {} },
      () => undefined,
      () => undefined,
      () => undefined,
      {}
    );

    processUpdate(
      "tool_call_update",
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "request-permission-1",
        title: "RequestPermissions",
        kind: "request-permissions",
        status: "completed",
        rawInput: {
          reason: "Need write access outside workspace",
          permissions: {
            file_system: {
              write: ["/tmp/outside"],
            },
          },
          decision: "approve",
          scope: "session",
          outcome: "approved",
        },
        rawOutput: {
          permissions: {
            file_system: {
              write: ["/tmp/outside"],
            },
          },
          scope: "session",
          outcome: "approved",
        },
      },
      messages,
      "session-1",
      "tool_call",
      () => "",
      { current: {} },
      { current: {} },
      () => undefined,
      () => undefined,
      () => undefined,
      {}
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolStatus).toBe("completed");
    expect(messages[0]?.toolRawInput).toMatchObject({
      reason: "Need write access outside workspace",
      decision: "approve",
      scope: "session",
      permissions: {
        file_system: {
          write: ["/tmp/outside"],
        },
      },
    });
  });

  it("merges completed permission request updates without losing the original prompt payload", () => {
    const messages: ChatMessage[] = [];

    processUpdate(
      "tool_call",
      {
        sessionUpdate: "tool_call",
        toolCallId: "request-permission-2",
        title: "RequestPermissions",
        kind: "request-permissions",
        status: "waiting",
        rawInput: {
          reason: "Need to compare against origin/main",
          options: [
            { optionId: "approved-for-session", kind: "allow_always" },
            { optionId: "approved", kind: "allow_once" },
            { optionId: "abort", kind: "reject_once" },
          ],
          toolCall: {
            title: "Run git rev-list --left-right --count origin/main...HEAD",
          },
        },
      },
      messages,
      "session-1",
      null,
      () => "",
      { current: {} },
      { current: {} },
      () => undefined,
      () => undefined,
      () => undefined,
      {}
    );

    processUpdate(
      "tool_call_update",
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "request-permission-2",
        title: "RequestPermissions",
        status: "completed",
        rawInput: {
          decision: "approve",
          scope: "turn",
          permissions: {},
        },
      },
      messages,
      "session-1",
      "tool_call",
      () => "",
      { current: {} },
      { current: {} },
      () => undefined,
      () => undefined,
      () => undefined,
      {}
    );

    expect(messages[0]?.toolStatus).toBe("completed");
    expect(messages[0]?.toolRawInput).toMatchObject({
      reason: "Need to compare against origin/main",
      options: [
        { optionId: "approved-for-session", kind: "allow_always" },
        { optionId: "approved", kind: "allow_once" },
        { optionId: "abort", kind: "reject_once" },
      ],
      decision: "approve",
      scope: "turn",
    });
  });
});
