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
});
