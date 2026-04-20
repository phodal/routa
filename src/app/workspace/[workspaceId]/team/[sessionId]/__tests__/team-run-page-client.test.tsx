import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamRunPageClient } from "../team-run-page-client";

const {
  mockDesktopAwareFetch,
  mockSelectSession,
  mockConnect,
  mockHeaderProps,
} = vi.hoisted(() => ({
  mockDesktopAwareFetch: vi.fn(),
  mockSelectSession: vi.fn(),
  mockConnect: vi.fn(async () => {}),
  mockHeaderProps: [] as Array<{ teamRuns: Array<{ sessionId: string; name?: string }> }>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        back: "Back",
        refresh: "Refresh",
      },
      team: {
        openSession: "Open session details",
        active: "ACTIVE",
        waitingForDelegation: "Waiting for delegation",
        loadingTeamRun: "Loading team run",
        teamRuns: "Team Runs",
      },
    },
  }),
}));

vi.mock("../use-real-team-run-params", () => ({
  useRealTeamRunParams: () => ({
    workspaceId: "default",
    sessionId: "session-1",
    isResolved: true,
  }),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    loading: false,
    sessionId: "session-1",
    updates: [],
    providers: [{ id: "codex", name: "Codex", description: "Codex", command: "codex-acp" }],
    selectedProvider: "codex",
    connect: mockConnect,
    prompt: vi.fn(async () => {}),
    promptSession: vi.fn(async () => {}),
    setProvider: vi.fn(),
    selectSession: mockSelectSession,
  }),
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [
      {
        id: "default",
        title: "Default Workspace",
      },
    ],
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
  useCodebases: () => ({
    codebases: [],
  }),
}));

vi.mock("@/client/hooks/use-notes", () => ({
  useNotes: () => ({
    notes: [],
  }),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/tiptap-input", () => ({
  TiptapInput: () => <div data-testid="tiptap-input" />,
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: mockDesktopAwareFetch,
}));

vi.mock("../team-run-page-sections", () => ({
  ObjectiveSidebarSection: () => <div data-testid="objective-sidebar" />,
  SessionTimelineSection: () => <div data-testid="session-timeline" />,
  TeamMembersSection: () => <div data-testid="team-members" />,
}));

vi.mock("../team-run-session-modal", () => ({
  TeamRunSessionModal: () => null,
}));

vi.mock("../team-run-page-header", () => ({
  TeamRunPageHeader: (props: { teamRuns: Array<{ sessionId: string; name?: string }> }) => {
    mockHeaderProps.push({ teamRuns: props.teamRuns });
    return (
      <div data-testid="team-run-header">
        {props.teamRuns.map((run) => run.name ?? run.sessionId).join(" | ")}
      </div>
    );
  },
}));

describe("TeamRunPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaderProps.length = 0;

    mockDesktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/specialists") {
        return { ok: true, json: async () => ({ specialists: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1") {
        return {
          ok: true,
          json: async () => ({
            session: {
              sessionId: "session-1",
              name: "Team - Original run",
              workspaceId: "default",
              provider: "codex",
              role: "ROUTA",
              createdAt: "2026-04-18T00:00:00.000Z",
            },
          }),
        } as Response;
      }
      if (url === "/api/sessions?workspaceId=default") {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              {
                sessionId: "session-1",
                name: "Team - Original run",
                workspaceId: "default",
                role: "ROUTA",
                createdAt: "2026-04-18T00:00:00.000Z",
              },
            ],
          }),
        } as Response;
      }
      if (url === "/api/sessions?workspaceId=default&surface=team") {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              {
                sessionId: "session-1",
                name: "Team - Original run",
                workspaceId: "default",
                role: "ROUTA",
                createdAt: "2026-04-18T00:00:00.000Z",
              },
              {
                sessionId: "session-2",
                name: "Team - Follow-up",
                workspaceId: "default",
                role: "ROUTA",
                createdAt: "2026-04-17T00:00:00.000Z",
              },
            ],
          }),
        } as Response;
      }
      if (url === "/api/agents?workspaceId=default") {
        return { ok: true, json: async () => ({ agents: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1/transcript") {
        return { ok: true, json: async () => ({ history: [], messages: [] }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
  });

  it("loads team run switcher options from the backend team surface", async () => {
    render(<TeamRunPageClient />);

    await waitFor(() => {
      expect(mockDesktopAwareFetch).toHaveBeenCalledWith(
        "/api/sessions?workspaceId=default&surface=team",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("team-run-header").textContent).toContain("Team - Original run");
      expect(screen.getByTestId("team-run-header").textContent).toContain("Team - Follow-up");
    });

    expect(mockHeaderProps.at(-1)?.teamRuns.map((run) => run.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });
});
