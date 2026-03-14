import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "../page";
import { useWorkspaces } from "@/client/hooks/use-workspaces";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span data-testid="next-image">{alt}</span>,
}));

vi.mock("@/client/components/home-input", () => ({
  HomeInput: ({ workspaceId }: { workspaceId?: string }) => (
    <div data-testid="home-input">{workspaceId ?? "no-workspace"}</div>
  ),
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: vi.fn(),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    loading: false,
    connect: vi.fn(),
    providers: [],
  }),
}));

vi.mock("@/client/hooks/use-skills", () => ({
  useSkills: () => ({
    allSkills: [],
  }),
}));

vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: () => null,
}));

vi.mock("@/client/components/notification-center", () => ({
  NotificationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  NotificationBell: () => null,
}));

describe("HomePage", () => {
  const fetchMock = vi.fn();
  const createWorkspace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(useWorkspaces).mockReturnValue({
      workspaces: [
        {
          id: "ws-1",
          title: "Platform",
          status: "active",
          metadata: {},
          createdAt: "2026-03-14T00:00:00.000Z",
          updatedAt: "2026-03-14T00:00:00.000Z",
        },
        {
          id: "ws-2",
          title: "Infra",
          status: "active",
          metadata: {},
          createdAt: "2026-03-14T00:00:00.000Z",
          updatedAt: "2026-03-14T00:00:00.000Z",
        },
      ],
      loading: false,
      fetchWorkspaces: vi.fn(),
      createWorkspace,
      archiveWorkspace: vi.fn(),
    });
  });

  it("defaults to a unified Kanban view and can filter to one workspace", async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          tasks: [
            {
              id: "task-1",
              title: "Homepage backlog task",
              status: "PENDING",
              columnId: "backlog",
              workspaceId: "ws-1",
              priority: "high",
              createdAt: "2026-03-14T00:00:00.000Z",
              updatedAt: "2026-03-14T00:00:00.000Z",
            },
            {
              id: "task-2",
              title: "Infra dev task",
              status: "IN_PROGRESS",
              columnId: "dev",
              workspaceId: "ws-2",
              priority: "medium",
              createdAt: "2026-03-14T00:00:00.000Z",
              updatedAt: "2026-03-14T00:00:00.000Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          tasks: [
            {
              id: "task-2",
              title: "Infra dev task",
              status: "IN_PROGRESS",
              columnId: "dev",
              workspaceId: "ws-2",
              priority: "medium",
              createdAt: "2026-03-14T00:00:00.000Z",
              updatedAt: "2026-03-14T00:00:00.000Z",
            },
          ],
        }),
      });

    render(<HomePage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks?allWorkspaces=true",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    expect(screen.getByText("Unified Kanban across workspaces")).toBeTruthy();
    expect(screen.getByText("Homepage backlog task")).toBeTruthy();
    expect(screen.getByText("Infra dev task")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter workspace tasks"), {
      target: { value: "ws-2" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/tasks?workspaceId=ws-2",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    expect(screen.getByText("Infra board")).toBeTruthy();
  });
});
