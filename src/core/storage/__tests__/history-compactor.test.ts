import { describe, it, expect } from "vitest";
import {
  compactSessionHistoryNotifications,
  getSessionHistoryChunkText,
  HistoryCompactor,
} from "../history-compactor";

describe("HistoryCompactor", () => {
  it("should be constructable with a database instance", () => {
    const mockDb = {} as any;
    const compactor = new HistoryCompactor(mockDb);
    expect(compactor).toBeInstanceOf(HistoryCompactor);
  });

  it("should expose a compact method", () => {
    const mockDb = {} as any;
    const compactor = new HistoryCompactor(mockDb);
    expect(typeof compactor.compact).toBe("function");
  });

  it("extracts text from ACP chunk payloads", () => {
    expect(getSessionHistoryChunkText({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      },
    })).toBe("hello");
  });

  it("merges consecutive agent message chunks and preserves non-chunk events", () => {
    const compacted = compactSessionHistoryNotifications([
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } } },
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } } },
      { sessionId: "s1", update: { sessionUpdate: "tool_call", name: "read_file" } },
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } } },
    ]);

    expect(compacted.originalCount).toBe(4);
    expect(compacted.compactedCount).toBe(3);
    expect(compacted.mergedChunks).toBe(2);
    expect(compacted.history[0].update?.sessionUpdate).toBe("agent_message");
    expect(compacted.history[0].update?.content?.text).toBe("Hello");
    expect(compacted.history[1].update?.sessionUpdate).toBe("tool_call");
    expect(compacted.history[2].update?.sessionUpdate).toBe("agent_message_chunk");
  });

  it("normalizes legacy chunk markers when merging legacy payloads", () => {
    const compacted = compactSessionHistoryNotifications([
      { type: "agent_message_chunk", text: "Hel" },
      { type: "agent_message_chunk", text: "lo" },
    ]);

    expect(compacted.compactedCount).toBe(1);
    expect(compacted.history[0].type).toBe("agent_message");
    expect(compacted.history[0].text).toBe("Hello");
    expect(compactSessionHistoryNotifications(compacted.history).compactedCount).toBe(1);
  });
});
