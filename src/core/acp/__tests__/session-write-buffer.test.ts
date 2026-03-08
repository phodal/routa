/**
 * Unit tests for SessionWriteBuffer
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionWriteBuffer } from "../session-write-buffer";
import type { SessionUpdateNotification } from "../http-session-store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNotification(
  sessionId: string,
  overrides: Partial<SessionUpdateNotification> = {},
): SessionUpdateNotification {
  return {
    sessionId,
    update: { sessionUpdate: "agent_message", content: { type: "text", text: "hello" } },
    ...overrides,
  };
}

function makeChunkNotification(
  sessionId: string,
  text: string,
): SessionUpdateNotification {
  return {
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SessionWriteBuffer", () => {
  let persistFn: ReturnType<typeof vi.fn<(sessionId: string, history: SessionUpdateNotification[]) => Promise<void>>>;
  let buffer: SessionWriteBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    persistFn = vi.fn().mockResolvedValue(undefined);
    buffer = new SessionWriteBuffer({
      persistFn,
      maxBufferSize: 5,
      debounceMs: 1000,
    });
  });

  afterEach(() => {
    buffer.dispose();
    vi.useRealTimers();
  });

  describe("add()", () => {
    it("buffers notifications without immediate persist", () => {
      buffer.add("s1", makeNotification("s1"));
      buffer.add("s1", makeNotification("s1"));

      expect(persistFn).not.toHaveBeenCalled();
      expect(buffer.bufferSize("s1")).toBe(2);
    });

    it("tracks separate buffers per session", () => {
      buffer.add("s1", makeNotification("s1"));
      buffer.add("s2", makeNotification("s2"));
      buffer.add("s2", makeNotification("s2"));

      expect(buffer.bufferSize("s1")).toBe(1);
      expect(buffer.bufferSize("s2")).toBe(2);
    });
  });

  describe("auto-flush on maxBufferSize", () => {
    it("flushes when buffer reaches maxBufferSize", async () => {
      for (let i = 0; i < 5; i++) {
        buffer.add("s1", makeNotification("s1"));
      }

      // Auto-flush is triggered via void promise, need to let microtasks run
      await vi.advanceTimersByTimeAsync(0);

      expect(persistFn).toHaveBeenCalledTimes(1);
      expect(persistFn).toHaveBeenCalledWith("s1", expect.any(Array));
      expect(buffer.bufferSize("s1")).toBe(0);
    });
  });

  describe("debounce timer flush", () => {
    it("flushes after debounce interval", async () => {
      buffer.add("s1", makeNotification("s1"));
      buffer.add("s1", makeNotification("s1"));

      expect(persistFn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(persistFn).toHaveBeenCalledTimes(1);
      expect(buffer.bufferSize("s1")).toBe(0);
    });

    it("resets debounce timer on new add", async () => {
      buffer.add("s1", makeNotification("s1"));

      await vi.advanceTimersByTimeAsync(800);
      expect(persistFn).not.toHaveBeenCalled();

      // Add another — should reset the timer
      buffer.add("s1", makeNotification("s1"));

      await vi.advanceTimersByTimeAsync(800);
      expect(persistFn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(persistFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("flush()", () => {
    it("flushes immediately and clears buffer", async () => {
      buffer.add("s1", makeNotification("s1"));
      buffer.add("s1", makeNotification("s1"));

      await buffer.flush("s1");

      expect(persistFn).toHaveBeenCalledTimes(1);
      expect(buffer.bufferSize("s1")).toBe(0);
    });

    it("is a no-op for empty buffer", async () => {
      await buffer.flush("s1");
      expect(persistFn).not.toHaveBeenCalled();
    });

    it("consolidates message chunks before persisting", async () => {
      buffer.add("s1", makeChunkNotification("s1", "Hello "));
      buffer.add("s1", makeChunkNotification("s1", "world"));

      await buffer.flush("s1");

      expect(persistFn).toHaveBeenCalledTimes(1);
      const persisted = persistFn.mock.calls[0][1] as SessionUpdateNotification[];
      // consolidateMessageHistory should merge chunks into a single agent_message
      expect(persisted.length).toBe(1);
      const update = persisted[0].update as Record<string, unknown>;
      expect(update.sessionUpdate).toBe("agent_message");
      const content = update.content as { text: string };
      expect(content.text).toBe("Hello world");
    });

    it("serializes concurrent flushes for the same session", async () => {
      let resolveFirst!: () => void;
      const firstCall = new Promise<void>((r) => { resolveFirst = r; });
      persistFn.mockImplementationOnce(() => firstCall);

      buffer.add("s1", makeNotification("s1"));
      const flush1 = buffer.flush("s1");

      // Let the first flush start (microtask for .then chain)
      await vi.advanceTimersByTimeAsync(0);
      expect(persistFn).toHaveBeenCalledTimes(1);

      buffer.add("s1", makeNotification("s1"));
      const flush2 = buffer.flush("s1");

      // Resolve first flush
      resolveFirst();
      await flush1;
      await flush2;

      // Second flush should have run after first completed
      expect(persistFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("flushAll()", () => {
    it("flushes all sessions", async () => {
      buffer.add("s1", makeNotification("s1"));
      buffer.add("s2", makeNotification("s2"));
      buffer.add("s3", makeNotification("s3"));

      await buffer.flushAll();

      expect(persistFn).toHaveBeenCalledTimes(3);
      expect(buffer.bufferSize("s1")).toBe(0);
      expect(buffer.bufferSize("s2")).toBe(0);
      expect(buffer.bufferSize("s3")).toBe(0);
    });
  });

  describe("hasPending()", () => {
    it("returns false for empty buffer", () => {
      expect(buffer.hasPending("s1")).toBe(false);
    });

    it("returns true when buffer has entries", () => {
      buffer.add("s1", makeNotification("s1"));
      expect(buffer.hasPending("s1")).toBe(true);
    });

    it("returns false after flush", async () => {
      buffer.add("s1", makeNotification("s1"));
      await buffer.flush("s1");
      expect(buffer.hasPending("s1")).toBe(false);
    });
  });

  describe("error handling", () => {
    it("does not throw when persistFn fails", async () => {
      persistFn.mockRejectedValueOnce(new Error("DB down"));

      buffer.add("s1", makeNotification("s1"));
      // Should not throw
      await buffer.flush("s1");

      expect(buffer.bufferSize("s1")).toBe(0);
    });

    it("continues working after a persist failure", async () => {
      persistFn.mockRejectedValueOnce(new Error("DB down"));

      buffer.add("s1", makeNotification("s1"));
      await buffer.flush("s1");

      // Add more and flush again — should work
      buffer.add("s1", makeNotification("s1"));
      await buffer.flush("s1");

      expect(persistFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("dispose()", () => {
    it("clears all timers", () => {
      buffer.add("s1", makeNotification("s1"));
      buffer.add("s2", makeNotification("s2"));

      buffer.dispose();

      // Advance past debounce — should NOT trigger flush
      vi.advanceTimersByTime(2000);
      expect(persistFn).not.toHaveBeenCalled();
    });
  });
});
