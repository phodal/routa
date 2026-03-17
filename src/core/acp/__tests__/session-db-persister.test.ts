import { describe, expect, it } from "vitest";

import type { SessionUpdateNotification } from "../http-session-store";
import { hasUserMessageInHistory } from "../session-db-persister";

describe("session-db-persister", () => {
  it("detects persisted user prompts in session history", () => {
    const history: SessionUpdateNotification[] = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "acp_status",
          status: "ready",
        },
      } as SessionUpdateNotification,
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message",
          content: { type: "text", text: "hello" },
        },
      } as SessionUpdateNotification,
    ];

    expect(hasUserMessageInHistory(history)).toBe(true);
  });

  it("returns false when no user prompt has been stored", () => {
    const history: SessionUpdateNotification[] = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "acp_status",
          status: "ready",
        },
      } as SessionUpdateNotification,
    ];

    expect(hasUserMessageInHistory(history)).toBe(false);
  });
});
