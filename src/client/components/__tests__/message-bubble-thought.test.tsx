import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      messageBubble: {
        thinking: "THINKING",
      },
    },
  }),
}));

import { MessageBubble } from "../message-bubble";
import type { ChatMessage } from "@/client/components/chat-panel/types";

describe("MessageBubble thought rendering", () => {
  it("does not render thought body until expanded", () => {
    const message: ChatMessage = {
      id: "thought-1",
      role: "thought",
      content: "Hidden by default",
      timestamp: new Date("2026-04-10T12:00:00Z"),
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByText("THINKING")).not.toBeNull();
    expect(screen.queryByText("Hidden by default")).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Hidden by default")).not.toBeNull();
  });
});
