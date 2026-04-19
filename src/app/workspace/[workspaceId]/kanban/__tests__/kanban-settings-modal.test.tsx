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
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /toggle automation for review/i }));
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "review", visible: true, position: 1 })],
        {
          review: expect.objectContaining({
            enabled: true,
            steps: [expect.objectContaining({
              role: "GATE",
            })],
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
        undefined,
      );
    });
  }, 15_000);

  it("does not expose A2A transport settings for a lane", async () => {
    render(
      <KanbanSettingsModal
        board={{
          ...board,
          columns: [board.columns[1]],
        }}
        columnAutomation={{
          review: {
            enabled: true,
            steps: [{
              id: "remote-review",
              transport: "a2a",
              role: "GATE",
              agentCardUrl: "https://agents.example.com/reviewer/agent-card.json",
              skillId: "review",
              authConfigId: "agent-auth",
            }],
          },
        }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "kanban-review-guard", name: "Review Guard", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByRole("option", { name: "A2A" })).toBeNull();
    expect(screen.queryByLabelText("Agent Card URL")).toBeNull();
    expect(screen.queryByLabelText("Skill ID")).toBeNull();
    expect(screen.queryByLabelText("Auth Config ID")).toBeNull();
    expect((screen.getByLabelText("Transport") as HTMLSelectElement).value).toBe("acp");
  });

  it("shows runtime settings on Board view", () => {
    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByLabelText("Dev supervision mode")).not.toBeNull();
    expect(screen.getByDisplayValue("2")).not.toBeNull();
  });

  it("shows GitHub import availability in board settings", () => {
    render(
      <KanbanSettingsModal
        board={{ ...board, githubTokenConfigured: true }}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        specialistLanguage="en"
        githubImportAvailable
        githubAccessSource="board"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByText("GitHub import")).not.toBeNull();
    expect(screen.getByText("Board config")).not.toBeNull();
    expect(screen.getByText("Configured")).not.toBeNull();
    expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0);
  });

  it("passes a board token update when saving GitHub settings", async () => {
    const onSave = vi.fn(async () => {});

    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.change(screen.getByLabelText("GitHub personal access token"), {
      target: { value: "github_pat_test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
        { token: "github_pat_test" },
      );
    });
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
        onClearAll={vi.fn(async () => {})}
        onSave={vi.fn(async () => {})}
      />,
    );

    expect(screen.getAllByRole("button").some((button) => button.textContent?.trim() === "Kanban")).toBe(true);
    expect(screen.getAllByRole("option", { name: "Review Guard" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("option", { name: "Team QA" })).toHaveLength(0);
  }, 15_000);

  it("shows the resolved auto provider in lane summaries", () => {
    const reviewBoard: KanbanBoardInfo = {
      ...board,
      autoProviderId: "codex",
      columns: [board.columns[1]],
    };

    render(
      <KanbanSettingsModal
        board={reviewBoard}
        columnAutomation={{
          review: {
            enabled: true,
            steps: [{ id: "step-1", role: "GATE", specialistId: "kanban-review-guard" }],
          },
        }}
        availableProviders={[
          { id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" },
          { id: "codex", name: "Codex", description: "Codex provider", command: "codex-acp" },
        ]}
        specialists={[{ id: "kanban-review-guard", name: "Review Guard", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByTestId("kanban-settings-provider").textContent).toMatch(/Auto/i);
    expect(screen.getAllByText("Review Guard").length).toBeGreaterThan(0);
  });

  it("keeps the selected lane workspace free of redundant summary labels", () => {
    const reviewBoard: KanbanBoardInfo = {
      ...board,
      columns: [board.columns[1]],
    };

    render(
      <KanbanSettingsModal
        board={reviewBoard}
        columnAutomation={{ review: { enabled: true, steps: [{ id: "step-1", role: "GATE" }] } }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "kanban-review-guard", name: "Review Guard", role: "GATE" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByText("Column workspace")).toBeNull();
    expect(screen.queryByText("Configure in stage map")).toBeNull();
  });

  it("applies the default story-readiness gate for the dev lane", async () => {
    const onSave = vi.fn(async () => {});
    const devBoard: KanbanBoardInfo = {
      ...board,
      columns: [{ id: "dev", name: "Dev", position: 0, stage: "dev" }],
    };

    render(
      <KanbanSettingsModal
        board={devBoard}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "kanban-dev-executor", name: "Dev Crafter", role: "CRAFTER" }]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /toggle automation for dev/i }));
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "dev", visible: true, position: 0 })],
        {
          dev: expect.objectContaining({
            requiredTaskFields: ["scope", "acceptance_criteria", "verification_plan"],
          }),
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
        undefined,
      );
    });
  });

  it("keeps Done PR publisher disabled by default when enabling automation", async () => {
    const onSave = vi.fn(async () => {});
    const doneBoard: KanbanBoardInfo = {
      ...board,
      columns: [{ id: "done", name: "Done", position: 0, stage: "done" }],
    };

    render(
      <KanbanSettingsModal
        board={doneBoard}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[
          { id: "kanban-done-reporter", name: "Done Reporter", role: "GATE" },
          { id: "kanban-pr-publisher", name: "PR Publisher", role: "DEVELOPER" },
        ]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /toggle automation for done/i }));
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "done", visible: true, position: 0 })],
        {
          done: expect.objectContaining({
            enabled: true,
            steps: [
              expect.objectContaining({
                specialistId: "kanban-done-reporter",
              }),
            ],
          }),
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
        undefined,
      );
      const firstCall = onSave.mock.calls[0];
      expect(firstCall).toBeDefined();
      const savedAutomation = (firstCall as unknown[] | undefined)?.[1] as { done?: { steps?: unknown[] } } | undefined;
      expect(savedAutomation?.done?.steps).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ specialistId: "kanban-pr-publisher" })]),
      );
    });
  });

  it("can explicitly enable the Done PR publisher step", async () => {
    const onSave = vi.fn(async () => {});
    const doneBoard: KanbanBoardInfo = {
      ...board,
      columns: [{ id: "done", name: "Done", position: 0, stage: "done" }],
    };

    render(
      <KanbanSettingsModal
        board={doneBoard}
        columnAutomation={{
          done: {
            enabled: true,
            transitionType: "entry",
            steps: [{ id: "step-1", role: "GATE", specialistId: "kanban-done-reporter" }],
          },
        }}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[
          { id: "kanban-done-reporter", name: "Done Reporter", role: "GATE" },
          { id: "kanban-pr-publisher", name: "PR Publisher", role: "DEVELOPER" },
        ]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /auto-open pr session in done/i }));
    fireEvent.click(screen.getByRole("button", { name: /save board settings/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "done", visible: true, position: 0 })],
        {
          done: expect.objectContaining({
            enabled: true,
            steps: [
              expect.objectContaining({ specialistId: "kanban-pr-publisher" }),
              expect.objectContaining({ specialistId: "kanban-done-reporter" }),
            ],
          }),
        },
        2,
        {
          mode: "watchdog_retry",
          inactivityTimeoutMinutes: 10,
          maxRecoveryAttempts: 1,
          completionRequirement: "turn_complete",
        },
        undefined,
      );
    });
  });

  it("clears all cards after confirmation", async () => {
    const onClearAll = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={vi.fn()}
        onClearAll={onClearAll}
        onSave={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("button", { name: /clear all cards/i }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith("Clear all cards from this workspace board?");
      expect(onClearAll).toHaveBeenCalledTimes(1);
    });

    confirmSpy.mockRestore();
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
        onClearAll={vi.fn(async () => {})}
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
        undefined,
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
        onClearAll={vi.fn(async () => {})}
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
        undefined,
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
        onClearAll={vi.fn(async () => {})}
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
        onClearAll={vi.fn(async () => {})}
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
        undefined,
      );
    });
  });

  it("warns before closing dirty edits with Escape", () => {
    const onClose = vi.fn();

    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={onClose}
        onClearAll={vi.fn(async () => {})}
        onSave={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByLabelText("Stage name"), { target: { value: "Queued" } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved board changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Unsaved board changes")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("supports discard and save-and-close from the unsaved changes prompt", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(async () => {});

    const { unmount } = render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={onClose}
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Stage name"), { target: { value: "Queued" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();

    render(
      <KanbanSettingsModal
        board={board}
        columnAutomation={{}}
        availableProviders={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[]}
        specialistLanguage="en"
        onClose={onClose}
        onClearAll={vi.fn(async () => {})}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Stage name"), { target: { value: "Queued" } });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Save & Close" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
