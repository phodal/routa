import { describe, expect, it, vi } from "vitest";
import { processUpdate } from "../message-processor";
import type { ChatMessage } from "../../types";

describe("processUpdate", () => {
  it("surfaces acp_status errors as info messages", () => {
    const messages: ChatMessage[] = [];
    const noopRef = { current: {} as Record<string, string | null> };
    const noopSetter = vi.fn();

    processUpdate(
      "acp_status",
      {
        sessionUpdate: "acp_status",
        status: "error",
        error: "ACP Error [-32603]: Internal error: Permission denied",
      },
      messages,
      "session-1",
      null,
      () => "",
      noopRef,
      noopRef,
      noopSetter,
      noopSetter,
      noopSetter,
      {},
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "info",
      content: "ACP Error [-32603]: Internal error: Permission denied",
      rawData: {
        sessionUpdate: "acp_status",
        status: "error",
      },
    });
  });
});
