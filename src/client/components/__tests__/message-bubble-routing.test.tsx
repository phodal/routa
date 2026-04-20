import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        save: "Save",
        cancel: "Cancel",
      },
      messageBubble: {
        thinking: "Thinking",
        input: "Input",
        submit: "Submit",
        pleaseAnswer: "Please answer {question}",
        failedToSubmit: "Failed to submit",
        requestPermissions: "Request permissions",
        permissionCommand: "Command",
        permissionReason: "Reason",
        permissionSuggestedAccess: "Suggested access",
        permissionTechnicalDetails: "Technical details",
        permissionAllow: "Allow",
        permissionDeny: "Deny",
        permissionApproved: "Approved",
        permissionDenied: "Denied",
        permissionScopeTurn: "This turn only",
        permissionScopeSession: "Entire session",
        permissionScopeHint: "Scope hint",
        task: "Task",
        plan: "Plan",
        priority: "Priority",
        tokens: "tokens",
        status: {
          done: "Done",
          failed: "Failed",
          running: "Running",
          pending: "Pending",
        },
      },
    },
  }),
}));

vi.mock("@/client/components/terminal/terminal-bubble", () => ({
  TerminalBubble: (props: { terminalId: string; data: string; command?: string }) => (
    <div data-testid="terminal-bubble">{`${props.terminalId}:${props.command ?? ""}:${props.data}`}</div>
  ),
}));

vi.mock("@/client/components/markdown/markdown-viewer", () => ({
  MarkdownViewer: (props: { content: string }) => <div data-testid="markdown-viewer">{props.content}</div>,
}));

vi.mock("@/client/components/task-progress-bar", () => ({
  TaskProgressBar: (props: { tasks: Array<{ title: string }> }) => (
    <div data-testid="task-progress-bar">{props.tasks.map((task) => task.title).join("|")}</div>
  ),
}));

vi.mock("@/client/components/tool-call-content", () => ({
  summarizeToolOutput: vi.fn(() => "summary"),
  ToolInputTable: (props: { input: Record<string, unknown> }) => (
    <div data-testid="tool-input-table">{Object.keys(props.input).join(",")}</div>
  ),
  ToolOutputView: (props: { output: unknown; toolName: string }) => (
    <div data-testid="tool-output-view">{`${props.toolName}:${JSON.stringify(props.output)}`}</div>
  ),
}));

vi.mock("@/client/components/chat-panel/thought-content", () => ({
  normalizeThoughtContent: (content: string) => `normalized:${content}`,
}));

vi.mock("@/client/components/tool-display-name", () => ({
  inferToolDisplayName: (_toolName: string | undefined, toolKind: string | undefined) => toolKind ?? "tool",
}));

vi.mock("@/client/components/chat-panel/tool-call-name", () => ({
  normalizeToolKind: (kind: string | undefined) => kind,
}));

import {
  AskUserQuestionBubble,
  hasAskUserQuestionAnswers,
  isAskUserQuestionMessage,
  isPermissionRequestMessage,
  MessageBubble,
} from "../message-bubble";
import type { ChatMessage } from "@/client/components/chat-panel/types";

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "content",
    timestamp: new Date("2026-04-19T00:00:00.000Z"),
    ...overrides,
  } as ChatMessage;
}

describe("message-bubble helpers", () => {
  it("detects ask-user answers and tool message kinds", () => {
    const withAnswers = makeMessage({
      role: "tool",
      toolRawInput: {
        questions: [{ header: "Scope", question: "Choose scope", options: [{ label: "Turn" }] }],
        answers: { "Choose scope": "Turn" },
      },
    });
    const permission = makeMessage({
      role: "tool",
      toolRawInput: {
        permissions: { command: ["gh", "api"] },
      },
    });

    expect(hasAskUserQuestionAnswers(withAnswers)).toBe(true);
    expect(isAskUserQuestionMessage(withAnswers)).toBe(true);
    expect(isPermissionRequestMessage(permission)).toBe(true);
    expect(hasAskUserQuestionAnswers(makeMessage({ role: "tool", toolRawInput: { answers: { empty: "   " } } }))).toBe(false);
  });
});

describe("MessageBubble routing", () => {
  it("renders user, assistant, info, usage, terminal, task, and plan variants", () => {
    const { rerender } = render(<MessageBubble message={makeMessage({ role: "user", content: "User text" })} />);
    expect(screen.getByText("User text")).not.toBeNull();

    rerender(<MessageBubble message={makeMessage({ role: "assistant", content: "Assistant markdown" })} />);
    expect(screen.getByTestId("markdown-viewer").textContent).toBe("Assistant markdown");

    rerender(<MessageBubble message={makeMessage({ role: "info", content: "Info text" })} />);
    expect(screen.getByText("Info text")).not.toBeNull();

    rerender(<MessageBubble message={makeMessage({ role: "info", usageUsed: 50, usageSize: 100, costAmount: 1.25, costCurrency: "USD" })} />);
    expect(screen.getByText("50%")).not.toBeNull();

    rerender(
      <MessageBubble
        message={makeMessage({
          role: "terminal",
          content: "stdout",
          terminalId: "term-1",
          terminalCommand: "npm",
        })}
      />,
    );
    expect(screen.getByTestId("terminal-bubble").textContent).toContain("term-1:npm:stdout");

    rerender(
      <MessageBubble
        message={makeMessage({
          role: "tool",
          toolKind: "task",
          toolStatus: "running",
          toolRawInput: { description: "Delegate task", subagent_type: "qa", prompt: "inspect it" },
        })}
      />,
    );
    expect(screen.getByText(/Task \[qa\]/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("inspect it")).not.toBeNull();

    rerender(
      <MessageBubble
        message={makeMessage({
          role: "plan",
          planEntries: [
            { content: "Step one", status: "pending", priority: "high" },
            { content: "Step two", status: "completed" },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("task-progress-bar").textContent).toBe("Step one|Step two");
  });

  it("renders fallback plan, thought, and tool output branches", () => {
    const { rerender } = render(
      <MessageBubble message={makeMessage({ role: "plan", content: "plain plan text", planEntries: [] })} />,
    );
    expect(screen.getByText("plain plan text")).not.toBeNull();

    rerender(<MessageBubble message={makeMessage({ role: "thought", content: "think step" })} />);
    expect(screen.queryByText("normalized:think step")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("normalized:think step")).not.toBeNull();

    rerender(
      <MessageBubble
        message={makeMessage({
          role: "tool",
          toolKind: "read-file",
          toolName: "ReadFile",
          toolStatus: "completed",
          toolRawInput: { file_path: "/tmp/example.ts" },
          toolRawOutput: { contents: "hello" },
        })}
      />,
    );
    expect(screen.getByText("read-file")).not.toBeNull();
    expect(screen.getByText("/tmp/example.ts")).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("tool-input-table").textContent).toContain("file_path");
    expect(screen.getByTestId("tool-output-view").textContent).toContain('read-file:{"contents":"hello"}');
  });
});

describe("AskUserQuestionBubble", () => {
  it("validates missing answers and submits selected responses", async () => {
    const onSubmit = vi.fn(async () => {});
    const message = makeMessage({
      id: "ask-1",
      role: "tool",
      toolCallId: "call-1",
      toolKind: "ask-user-question",
      toolRawInput: {
        questions: [
          {
            header: "Scope",
            question: "Choose scope",
            options: [{ label: "Turn" }, { label: "Session" }],
          },
          {
            header: "Checks",
            question: "Choose checks",
            options: [{ label: "Lint" }, { label: "Tests" }],
            multiSelect: true,
          },
        ],
      },
    });

    render(<AskUserQuestionBubble message={message} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByText("Please answer Scope")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Turn" }));
    fireEvent.click(screen.getByRole("button", { name: "Lint" }));
    fireEvent.click(screen.getByRole("button", { name: "Tests" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("call-1", {
        questions: message.toolRawInput?.questions,
        answers: {
          "Choose scope": "Turn",
          "Choose checks": "Lint, Tests",
        },
      });
    });
  });

  it("shows submission errors and hides controls when answers already exist", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("submit failed");
    });
    const message = makeMessage({
      id: "ask-2",
      role: "tool",
      toolCallId: "call-2",
      toolKind: "ask-user-question",
      toolRawInput: {
        questions: [{ header: "Mode", question: "Choose mode", options: [{ label: "Auto" }] }],
      },
    });

    const { rerender } = render(<AskUserQuestionBubble message={message} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText("submit failed")).not.toBeNull();
    });

    rerender(
      <AskUserQuestionBubble
        message={makeMessage({
          ...message,
          id: "ask-3",
          toolRawInput: {
            questions: [{ header: "Mode", question: "Choose mode", options: [{ label: "Auto" }] }],
            answers: { "Choose mode": "Auto" },
          },
        })}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("class")).toContain("cursor-default");
  });
});
