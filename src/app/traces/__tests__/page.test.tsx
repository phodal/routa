import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

let currentSearch = "";
const pushMock = vi.fn((href: string) => {
  currentSearch = href.split("?")[1] ?? "";
});
const replaceMock = vi.fn((href: string) => {
  currentSearch = href.split("?")[1] ?? "";
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      trace: {
        backToHome: "Back",
        home: "Home",
        sessions: "Sessions",
        sessionFound: "1 session found",
        sessionsFound: "{count} sessions found",
        loadingSessions: "Loading sessions",
        noSessionsFound: "No sessions found",
        startConversationHint: "Start a conversation",
        noSessionSelected: "No session selected",
        selectSessionHint: "Select a session",
      },
      traces: {
        agentTraceViewer: "Agent Trace Viewer",
        browseTraces: "Browse traces",
        session: "Session",
        copyShareableUrl: "Copy",
        copyLink: "Copy link",
        hideSessions: "Hide Sessions",
        showSessions: "Show Sessions",
      },
      common: {
        loading: "Loading",
        refresh: "Refresh",
      },
    },
  }),
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [],
    loading: false,
    createWorkspace: vi.fn(),
  }),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children, workspaceSwitcher }: { children: ReactNode; workspaceSwitcher?: ReactNode }) => (
    <div>
      {workspaceSwitcher}
      {children}
    </div>
  ),
}));

vi.mock("@/client/components/traces-page-header", () => ({
  TracesPageHeader: ({ onRefresh }: { onRefresh: () => void }) => (
    <button type="button" onClick={onRefresh}>
      Refresh
    </button>
  ),
}));

vi.mock("@/client/components/traces-view-tabs", () => ({
  TracesViewTabs: ({ onTabChange }: { onTabChange: (tab: "chat" | "event-bridge") => void }) => (
    <div>
      <button type="button" onClick={() => onTabChange("chat")}>Chat Tab</button>
      <button type="button" onClick={() => onTabChange("event-bridge")}>Trace Tab</button>
    </div>
  ),
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div>Workspace Switcher</div>,
}));

vi.mock("@/client/components/trace-panel", () => ({
  TracePanel: ({ sessionId }: { sessionId: string | null }) => <div>{`trace-panel:${sessionId}`}</div>,
}));

vi.mock("@/client/components/event-bridge-trace-panel", () => ({
  EventBridgeTracePanel: ({ sessionId }: { sessionId: string | null }) => <div>{`event-panel:${sessionId}`}</div>,
}));

import TracePage from "../page";

describe("TracePage", () => {
  beforeEach(() => {
    currentSearch = "";
    pushMock.mockClear();
    replaceMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("does not refetch the session list when switching session or trace view", async () => {
    let listTraceFetches = 0;
    let sessionsFetches = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/traces") {
        listTraceFetches += 1;
        return {
          ok: true,
          json: async () => ({
            traces: [
              { sessionId: "session-a", timestamp: "2026-04-07T10:00:00.000Z" },
              { sessionId: "session-b", timestamp: "2026-04-07T09:00:00.000Z" },
            ],
          }),
        } as Response;
      }

      if (url === "/api/sessions") {
        sessionsFetches += 1;
        return {
          ok: true,
          json: async () => ({
            sessions: [
              { sessionId: "session-a", name: "Alpha", workspaceId: "default" },
              { sessionId: "session-b", name: "Beta", workspaceId: "default" },
            ],
          }),
        } as Response;
      }

      if (url === "/api/traces?sessionId=session-a") {
        return {
          ok: true,
          json: async () => ({ traces: [{ sessionId: "session-a", timestamp: "2026-04-07T10:00:00.000Z" }] }),
        } as Response;
      }

      if (url === "/api/traces?sessionId=session-b") {
        return {
          ok: true,
          json: async () => ({ traces: [{ sessionId: "session-b", timestamp: "2026-04-07T09:00:00.000Z" }] }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TracePage />);

    await waitFor(() => {
      expect(screen.getByText("trace-panel:session-a")).toBeTruthy();
    });

    expect(listTraceFetches).toBe(1);
    expect(sessionsFetches).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));

    await waitFor(() => {
      expect(screen.getByText("trace-panel:session-b")).toBeTruthy();
    });

    expect(listTraceFetches).toBe(1);
    expect(sessionsFetches).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Trace Tab" }));

    await waitFor(() => {
      expect(screen.getByText("event-panel:session-b")).toBeTruthy();
    });

    expect(listTraceFetches).toBe(1);
    expect(sessionsFetches).toBe(1);
  });
});
