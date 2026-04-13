import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpPromptResult } from "@/client/acp-client";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "../chat-panel";

const {
  mockVisibleMessages,
  mockSetMessagesBySession,
  mockFetchSessions,
} = vi.hoisted(() => ({
  mockVisibleMessages: [] as Array<Record<string, unknown>>,
  mockSetMessagesBySession: vi.fn(),
  mockFetchSessions: vi.fn(),
}));

const resolvedPrompt = (): Promise<AcpPromptResult | null> => Promise.resolve(null);

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      chat: {
        typeMessage: "Type a message...",
        typeCreateSession: "Type to create session...",
        connectFirst: "Connect first",
        authRequiredTitle: "Authentication required",
        availableAuthMethods: "Available auth methods",
        viewToggle: {
          chat: "Chat",
          trace: "Trace",
        },
      },
      sessions: {
        placeholder: "Send a message to start.",
        repoPath: "Repo path",
        sessionInfo: "Session info",
      },
      common: {
        tasks: "Tasks",
        dismiss: "Dismiss",
        copyToClipboard: "Copy to clipboard",
        save: "Save",
        cancel: "Cancel",
      },
      messageBubble: {
        requestPermissions: "Request permissions",
        permissionReason: "Reason",
        permissionCommand: "Command",
        permissionSuggestedAccess: "Suggested access",
        permissionTechnicalDetails: "Technical details",
        permissionAllow: "Allow",
        permissionDeny: "Deny",
        permissionScopeSession: "Entire session",
        permissionScopeTurn: "This turn only",
        permissionApproved: "Approved",
        permissionDenied: "Denied",
        permissionScopeHint: "Scope hint",
        failedToSubmit: "Failed to submit",
      },
    },
  }),
}));

vi.mock("../tiptap-input", () => ({
  TiptapInput: ({ onSend }: { onSend: (text: string, context: Record<string, unknown>) => Promise<void> }) => (
    <button type="button" onClick={() => void onSend("continue", {})}>
      Send mock prompt
    </button>
  ),
}));

vi.mock("../chat-panel/hooks", () => ({
  useChatMessages: () => ({
    visibleMessages: mockVisibleMessages,
    sessions: [],
    sessionModeById: {},
    isSessionRunning: false,
    checklistItems: [],
    fileChangesState: { files: new Map(), totalAdded: 0, totalRemoved: 0 },
    usageInfo: null,
    setMessagesBySession: mockSetMessagesBySession,
    setIsSessionRunning: vi.fn(),
    fetchSessions: mockFetchSessions,
    resetStreamingRefs: vi.fn(),
  }),
}));

describe("ChatPanel session targeting", () => {
  beforeEach(() => {
    mockVisibleMessages.splice(0, mockVisibleMessages.length);
    mockSetMessagesBySession.mockReset();
    mockFetchSessions.mockReset();
  });

  it("dismisses stale permission cards when the server reports no pending interactive request", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockVisibleMessages.splice(0, mockVisibleMessages.length, {
      id: "tool-1",
      role: "tool",
      content: "RequestPermissions",
      timestamp: new Date(),
      toolCallId: "request-permission-1",
      toolKind: "request-permissions",
      toolStatus: "running",
      toolRawInput: {
        permissions: { "fs.read": true },
        reason: "Need repo read access",
      },
    });
    const acp = {
      connected: true,
      sessionId: "session-123",
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(resolvedPrompt),
      respondToUserInput: vi.fn(async () => {
        throw new Error("No pending interactive request found for this session");
      }),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(mockSetMessagesBySession).toHaveBeenCalledTimes(1);
    });

    const updateMessages = mockSetMessagesBySession.mock.calls[0][0] as (prev: Record<string, Array<Record<string, unknown>>>) => Record<string, Array<Record<string, unknown>>>;
    const nextState = updateMessages({
      "session-123": mockVisibleMessages,
    });
    expect(nextState["session-123"][0]).toMatchObject({
      toolStatus: "failed",
      toolRawOutput: {
        message: "No pending interactive request found for this session",
      },
    });
  });

  it("sends prompts to the ensured active session even when ACP has not selected it yet", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const onSelectSession = vi.fn(async () => {});
    const onEnsureSession = vi.fn(async () => "session-123");
    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(resolvedPrompt),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={onEnsureSession}
        onSelectSession={onSelectSession}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send mock prompt" }));

    await waitFor(() => {
      expect(onSelectSession).toHaveBeenCalledWith("session-123");
      expect(acp.promptSession).toHaveBeenCalledWith("session-123", "continue", undefined);
    });
  });

  it("hides non-interactive process output cards from the chat stream", () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockVisibleMessages.splice(0, mockVisibleMessages.length, {
      id: "process-1",
      role: "terminal",
      content: "stderr line",
      timestamp: new Date(),
      terminalId: "process-session-123",
      terminalCommand: "Codex",
      terminalArgs: ["stderr"],
      terminalInteractive: false,
      terminalExited: false,
      terminalExitCode: null,
    }, {
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      timestamp: new Date(),
    });

    const acp = {
      connected: true,
      sessionId: "session-123",
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(resolvedPrompt),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("stderr line")).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
  });
});
