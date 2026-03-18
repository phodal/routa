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

    render(
      <KanbanSettingsModal
        board={board}
        visibleColumns={["todo", "review"]}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    fireEvent.click(screen.getByRole("switch", { name: /automation/i }));
    fireEvent.change(screen.getAllByLabelText("Provider")[0], { target: { value: "claude" } });
    fireEvent.change(screen.getAllByLabelText("Specialist")[0], { target: { value: "verify" } });
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        ["todo", "review"],
        {
          review: expect.objectContaining({
            enabled: true,
            steps: [expect.objectContaining({
              providerId: "claude",
              specialistId: "verify",
              specialistName: "Verifier",
              role: "GATE",
            })],
            providerId: "claude",
            specialistId: "verify",
            specialistName: "Verifier",
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
        visibleColumns={["todo", "review"]}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByLabelText("Dev supervision mode")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show runtime settings/i }));
    expect(screen.getByLabelText("Dev supervision mode")).not.toBeNull();
  });
});
