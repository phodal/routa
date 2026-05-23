import { describe, expect, it } from "vitest";

import {
  compactSessionHistoryForPersistence,
  compactSessionNotificationForPersistence,
  compactToolCallParamsDeltaUpdate,
} from "../session-notification-retention";

describe("session notification retention", () => {
  it("leaves non-tool-call-parameter notifications unchanged", () => {
    const notification = {
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message",
        content: { type: "text", text: "hello" },
      },
    };

    expect(compactSessionNotificationForPersistence(notification)).toBe(notification);
  });

  it("drops accumulated tool-call JSON and parsed input before persistence", () => {
    const update = compactToolCallParamsDeltaUpdate({
      sessionUpdate: "tool_call_params_delta",
      toolCallId: "tool-1",
      title: "Used tool: update_card",
      partialJson: "x".repeat(700),
      accumulatedJson: JSON.stringify({ text: "y".repeat(2_000) }),
      parsedInput: { title: "Large card", body: "z".repeat(1_000) },
    });

    expect(update).toMatchObject({
      sessionUpdate: "tool_call_params_delta",
      toolCallId: "tool-1",
      title: "Used tool: update_card",
      partialJsonBytes: 700,
      parsedInputKeys: 2,
      compacted: true,
      compactionReason: "tool_call_params_delta_persistence",
    });
    expect(update.partialJson).toBe(`${"x".repeat(512)}...`);
    expect(update.accumulatedJsonBytes).toBeGreaterThan(2_000);
    expect(update).not.toHaveProperty("accumulatedJson");
    expect(update).not.toHaveProperty("parsedInput");
  });

  it("does not recompact an already compacted delta", () => {
    const compacted = {
      sessionUpdate: "tool_call_params_delta",
      toolCallId: "tool-1",
      partialJson: `${"x".repeat(512)}...`,
      partialJsonBytes: 700,
      accumulatedJsonBytes: 2_050,
      parsedInputKeys: 2,
      compacted: true,
      compactionReason: "tool_call_params_delta_persistence",
    };

    expect(compactToolCallParamsDeltaUpdate(compacted)).toBe(compacted);
  });

  it("compacts only matching notifications in a session history array", () => {
    const history = compactSessionHistoryForPersistence([
      {
        sessionId: "session-1",
        update: { sessionUpdate: "agent_message", content: { type: "text", text: "ok" } },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call_params_delta",
          partialJson: "{\"a\"",
          accumulatedJson: "{\"a\":1}",
          parsedInput: { a: 1 },
        },
      },
    ]);

    expect(history[0].update).toHaveProperty("content");
    expect(history[1].update).toMatchObject({
      sessionUpdate: "tool_call_params_delta",
      compacted: true,
      accumulatedJsonBytes: 7,
      parsedInputKeys: 1,
    });
    expect(history[1].update).not.toHaveProperty("accumulatedJson");
    expect(history[1].update).not.toHaveProperty("parsedInput");
  });
});
