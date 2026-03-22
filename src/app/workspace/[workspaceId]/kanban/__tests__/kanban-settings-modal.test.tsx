import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanSettingsModal } from "../kanban-settings-modal";
import type { KanbanBoardInfo } from "../../types";

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Delivery Board",
  isDefault: true,
  sessionConcurrencyLimit: 2,
  devSessionSupervision: {
    mode: "watchdog_retry",
    inactivityTimeoutMinutes: 10,
    maxRecoveryAttempts: 1,
    completionRequirement: "turn_complete",
  },
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [
    { id: "todo", name: "To Do", position: 0, stage: "backlog" },
    { id: "review", name: "Review", position: 1, stage: "review" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

describe("KanbanSettingsModal", () => {
  it("applies recommended defaults and saves updated automation", async () => {
    const onSave = vi.fn(async () => {});
    const reviewBoard: KanbanBoardInfo = {
      ...board,
      columns: [board.columns[1]],
    };

    render(
      <KanbanSettingsModal
        board={reviewBoard}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "kanban-review-guard", name: "Review Guard", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Automation$/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /toggle automation for review/i }));
    fireEvent.click(screen.getByTestId("kanban-settings-provider"));
    fireEvent.click(screen.getByRole("button", { name: /claude code/i }));
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "review", visible: true, position: 1 })],
        {
          review: expect.objectContaining({
            enabled: true,
            steps: [expect.objectContaining({
              providerId: "claude",
              role: "GATE",
            })],
            providerId: "claude",
            role: "GATE",
            transitionType: "exit",
            requiredArtifacts: ["screenshot", "test_results"],
          }),
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
      );
    });
  });

  it("keeps runtime settings collapsed until requested", () => {
    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByLabelText("Dev supervision mode")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /runtime/i }));
    expect(screen.getByLabelText("Dev supervision mode")).not.toBeNull();
  });

  it("defaults specialist filtering to kanban in board settings", () => {
    const reviewBoard: KanbanBoardInfo = {
      ...board,
      columns: [board.columns[1]],
    };

    render(
      <KanbanSettingsModal
        board={reviewBoard}
        columnAutomation={{ review: { enabled: true, steps: [{ id: "step-1", role: "GATE", specialistId: "kanban-review-guard" }] } }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[
          { id: "kanban-review-guard", name: "Review Guard", role: "GATE" },
          { id: "team-qa", name: "Team QA", role: "GATE" },
        ]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Automation$/i }));
    expect(screen.getAllByRole("button").some((button) => button.textContent?.trim() === "Kanban")).toBe(true);
    expect(screen.getAllByRole("option", { name: "Review Guard" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("option", { name: "Team QA" })).toHaveLength(0);
  });

  it("treats blocked as a manual-only lane when saving", async () => {
    const onSave = vi.fn(async () => {});
    const blockedBoard: KanbanBoardInfo = {
      ...board,
      columns: [{ id: "blocked", name: "Blocked", position: 0, stage: "blocked" }],
    };

    render(
      <KanbanSettingsModal
        board={blockedBoard}
        columnAutomation={{ blocked: { enabled: true, steps: [{ id: "step-1", role: "ROUTA", providerId: "claude" }] } }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /toggle visibility for blocked/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "blocked", visible: true, position: 0 })],
        {
          blocked: expect.objectContaining({ enabled: false }),
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
      );
    });
  });

  it("saves reordered stage positions", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /move to do down/i }));
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [
          expect.objectContaining({ id: "review", position: 0, visible: true }),
          expect.objectContaining({ id: "todo", position: 1, visible: true }),
        ],
        {
          review: { enabled: false },
          todo: { enabled: false },
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
      );
    });
  });

  it("adds and deletes stages from the stage map", async () => {
    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add stage/i }));
    expect(screen.getByRole("button", { name: /delete stage 3/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /delete stage 3/i }));
    expect(screen.queryByRole("button", { name: /delete stage 3/i })).toBeNull();
  });

  it("edits selected stage structure from the stage map sidebar", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Stage name"), { target: { value: "Queued" } });
    fireEvent.change(screen.getByLabelText("Stage type"), { target: { value: "blocked" } });
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [
          expect.objectContaining({ id: "todo", name: "Queued", stage: "blocked" }),
          expect.objectContaining({ id: "review", name: "Review", stage: "review" }),
        ],
        expect.objectContaining({
          todo: expect.objectContaining({ enabled: false }),
        }),
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
      );
    });
  });
});
