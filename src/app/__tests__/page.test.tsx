import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "../page";

const navState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

const workspaceState = vi.hoisted(() => ({
  workspaces: [
    {
      id: "default",
      title: "Default Workspace",
      status: "active" as const,
      metadata: {},
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
  ],
  codebases: [],
}));

const acpState = vi.hoisted(() => ({
  connected: true,
  loading: false,
  connect: vi.fn(async () => {}),
}));

const desktopAwareFetchMock = vi.hoisted(() => vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);

  if (url.startsWith("/api/sessions?workspaceId=")) {
    return {
      ok: true,
      json: async () => ({ sessions: [] }),
    } as Response;
  }

  if (url.startsWith("/api/workspaces/")) {
    return {
      ok: true,
      json: async () => ({}),
    } as Response;
  }

  throw new Error(`Unexpected fetch: ${url}`);
}));

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => navState.searchParams.get(key),
  }),
  useRouter: () => ({
    replace: navState.replace,
  }),
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        workspace: "Workspace",
        cancel: "Cancel",
        enter: "Enter",
      },
      home: {
        loadingWorkspaces: "Loading workspaces...",
        whatToAdvance: "Which execution mode do you want to enter?",
        homePrimaryHint: "All three modes are multi-agent.",
        surfaceLabel: "Mode",
        modeTechnicalLabel: "Technical detail",
        sessionsSurfaceTitle: "Sessions Mode",
        kanbanSurfaceTitle: "Kanban Mode",
        teamSurfaceTitle: "Team Mode",
        modeSessionDescription: "Session primary description",
        modeSessionTechnical: "Session technical detail",
        modeKanbanDescription: "Kanban primary description",
        modeKanbanTechnical: "Kanban technical detail",
        modeTeamDescription: "Team primary description",
        modeTeamTechnical: "Team technical detail",
        readinessTitle: "Readiness",
        readinessModel: "Connect model",
        readinessCodebase: "Select codebase",
        readinessWorkspace: "Workspace ready",
        continueWork: "Continue recent work",
        continueBoard: "Continue board",
      },
      nav: {
        sessions: "Sessions",
        kanban: "Kanban",
        team: "Team",
      },
      workspace: {
        kanbanDescription: "Kanban mode description",
        recoverSession: "Recover session",
      },
    },
  }),
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: workspaceState.workspaces,
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
  useCodebases: () => ({
    codebases: workspaceState.codebases,
    fetchCodebases: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: acpState.connected,
    loading: acpState.loading,
    connect: acpState.connect,
    providers: [],
  }),
}));

vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: ({ open }: { open: boolean }) => (open ? <div data-testid="settings-panel" /> : null),
  loadDefaultProviders: () => ({}),
  loadDockerOpencodeAuthJson: () => "",
  loadProviderConnections: () => ({}),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children, workspaceSwitcher }: { children: ReactNode; workspaceSwitcher?: ReactNode }) => (
    <div data-testid="desktop-shell">
      {workspaceSwitcher}
      {children}
    </div>
  ),
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker" />,
}));

vi.mock("@/client/components/home-page-sections", () => ({
  OnboardingCard: () => <div data-testid="onboarding-card" />,
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: desktopAwareFetchMock,
}));

vi.mock("@/client/utils/custom-acp-providers", () => ({
  loadCustomAcpProviders: () => [],
}));

describe("HomePage", () => {
  beforeEach(() => {
    navState.searchParams = new URLSearchParams();
    navState.replace.mockClear();
    workspaceState.codebases = [];
    acpState.connected = true;
    acpState.loading = false;
    acpState.connect.mockClear();
    desktopAwareFetchMock.mockClear();
    window.localStorage.clear();
    window.localStorage.setItem("routa.onboarding.completed", "true");
  });

  it("uses Kanban as the default primary entry action", async () => {
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Kanban Mode/i }).getAttribute("href")).toBe("/workspace/default/kanban");
    });
  });

  it("renders the mode cards with separate technical details", async () => {
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText("Kanban primary description")).toBeTruthy();
    });

    expect(screen.getByText("Session technical detail")).toBeTruthy();
    expect(screen.getByText("Kanban technical detail")).toBeTruthy();
    expect(screen.getByText("Team technical detail")).toBeTruthy();
    expect(screen.getAllByText("Technical detail")).toHaveLength(3);
    expect(screen.queryByText("Kanban mode description")).toBeNull();
  });
});
