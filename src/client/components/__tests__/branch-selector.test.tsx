import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BranchSelector } from "../branch-selector";

const { desktopAwareFetchMock } = vi.hoisted(() => ({
  desktopAwareFetchMock: vi.fn(),
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch: desktopAwareFetchMock,
}));

vi.mock("../button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      branchSelector: {
        uncommittedChanges: "Uncommitted changes",
        switchBranch: "Switch branch",
        fetchRemote: "Refresh branches",
        filterBranches: "Search branches",
        local: "Local branches",
        remote: "Remote branches",
        loadingBranches: "Loading branches",
        noMatchingBranches: "No matching branches",
        noBranchesFound: "No branches found",
        pullNewCommits: "Pull {count} new commit{plural}",
      },
      common: {
        refresh: "Refresh",
      },
    },
  }),
}));

describe("BranchSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads branch data, shows status badges, and switches branches", async () => {
    desktopAwareFetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          current: "main",
          local: ["main", "feature/a"],
          remote: ["origin/main", "feature/b"],
          status: { ahead: 0, behind: 2, hasUncommittedChanges: true },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true, branch: "feature/a" }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          current: "feature/a",
          local: ["main", "feature/a"],
          remote: ["origin/main", "feature/b"],
          status: { ahead: 1, behind: 0, hasUncommittedChanges: false },
        }),
      });

    const onBranchChange = vi.fn();

    render(
      <BranchSelector
        repoPath="/repo/main"
        currentBranch="main"
        onBranchChange={onBranchChange}
      />,
    );

    await waitFor(() => {
      expect(desktopAwareFetchMock).toHaveBeenCalledWith("/api/clone/branches?repoPath=%2Frepo%2Fmain");
    });

    expect(screen.getByText("2↓")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /main/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search branches")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "feature/a" }));

    await waitFor(() => {
      expect(onBranchChange).toHaveBeenCalledWith("feature/a");
    });
    expect(desktopAwareFetchMock).toHaveBeenCalledWith("/api/clone/branches", expect.objectContaining({
      method: "PATCH",
    }));
  });

  it("filters branches, pulls the current branch, and refreshes remotes", async () => {
    desktopAwareFetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          current: "main",
          local: ["main", "feature/a", "fix/b"],
          remote: ["feature/remote"],
          status: { ahead: 0, behind: 1, hasUncommittedChanges: false },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          current: "main",
          local: ["main", "feature/a", "fix/b"],
          remote: ["feature/remote"],
          status: { ahead: 0, behind: 1, hasUncommittedChanges: false },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          current: "main",
          local: ["main", "feature/a", "fix/b"],
          remote: ["feature/remote"],
          status: { ahead: 0, behind: 1, hasUncommittedChanges: false },
        }),
      });

    render(
      <BranchSelector
        repoPath="/repo/main"
        currentBranch="main"
        onBranchChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(desktopAwareFetchMock).toHaveBeenCalledWith("/api/clone/branches?repoPath=%2Frepo%2Fmain");
    });

    fireEvent.click(screen.getByRole("button", { name: /main/i }));

    const search = await screen.findByPlaceholderText("Search branches");
    expect(screen.getByRole("button", { name: "Pull 1 new commit" })).not.toBeNull();
    fireEvent.change(search, { target: { value: "feature" } });

    expect(await screen.findByRole("button", { name: "feature/a" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "fix/b" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pull 1 new commit" }));

    await waitFor(() => {
      expect(desktopAwareFetchMock).toHaveBeenCalledWith("/api/clone/branches", expect.objectContaining({
        method: "PATCH",
      }));
    });

    fireEvent.click(screen.getByTitle("Refresh branches"));

    await waitFor(() => {
      expect(desktopAwareFetchMock).toHaveBeenCalledWith("/api/clone/branches", expect.objectContaining({
        method: "POST",
      }));
    });
  });
});
