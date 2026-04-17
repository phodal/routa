/**
 * PR Auto-Create Listener
 *
 * Listens for PR_CREATE_REQUESTED events emitted by the WorkflowOrchestrator
 * when a task completes the done-lane automation with autoCreatePullRequest
 * enabled and no existing PR.
 *
 * Steps:
 *   1. Resolve worktree path and current branch
 *   2. Push the branch to origin (if not already pushed)
 *   3. Create a Pull Request via gh CLI (--body-file for safe multi-line body)
 *   4. Update the task with the PR URL
 */

import { AgentEvent, AgentEventType } from "../events/event-bus";
import { getServerBridge } from "../platform";
import type { RoutaSystem } from "../routa-system";
import { shellQuote } from "../git/git-utils";

const HANDLER_KEY = "kanban-pr-auto-create";

/**
 * Shell-escape a single argument for safe interpolation.
 * Reuses the project-wide shellQuote utility.
 */
function shellEscape(arg: string): string {
  return shellQuote(arg);
}

/**
 * Execute a command via the platform bridge.
 * Throws if the process API is not available.
 */
async function execCommand(
  command: string,
  cwd: string,
  timeout = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  const bridge = getServerBridge();
  if (!bridge.process.isAvailable()) {
    throw new Error("Process API is not available in this environment.");
  }
  return bridge.process.exec(command, { cwd, timeout });
}

/**
 * Start listening for PR_CREATE_REQUESTED events.
 */
export function startPrAutoCreateListener(system: RoutaSystem): void {
  system.eventBus.on(HANDLER_KEY, async (event: AgentEvent) => {
    if (event.type !== AgentEventType.PR_CREATE_REQUESTED) return;

    const { cardId, cardTitle, boardId, worktreeId } = event.data as {
      cardId: string;
      cardTitle: string;
      boardId: string;
      worktreeId: string;
    };

    console.log(
      `[PrAutoCreate] Processing PR creation request for task ${cardId}.`,
    );

    try {
      // 1. Resolve worktree
      const worktree = await system.worktreeStore.get(worktreeId);
      if (!worktree?.worktreePath) {
        console.warn(
          `[PrAutoCreate] Worktree ${worktreeId} not found or has no path. Skipping.`,
        );
        return;
      }

      const cwd = worktree.worktreePath;
      const branch = worktree.branch;

      if (!branch) {
        console.warn(
          `[PrAutoCreate] Worktree ${worktreeId} has no branch. Skipping.`,
        );
        return;
      }

      // 2. Push the branch to origin (best-effort — may already be pushed)
      try {
        await execCommand(
          `git push -u origin ${shellEscape(branch)}`,
          cwd,
          60_000,
        );
        console.log(
          `[PrAutoCreate] Pushed branch ${branch} for task ${cardId}.`,
        );
      } catch (pushErr) {
        // Branch may already be up-to-date or push may fail for non-critical reasons.
        // Continue to PR creation since the branch might already exist remotely.
        console.warn(
          `[PrAutoCreate] Push warning for task ${cardId}:`,
          pushErr instanceof Error ? pushErr.message : pushErr,
        );
      }

      // 3. Get the task for PR title/body
      const task = await system.taskStore.get(cardId);

      // 4. Create PR via gh CLI
      const prTitle = task?.title ?? cardTitle;
      const prBody = task?.objective ?? "Auto-created PR from kanban done-lane.";
      const baseBranch = worktree.baseBranch;

      // Use --body-file to avoid shell injection and multi-line issues.
      // Write body to a temp file, then pass the path to gh.
      const fs = await import("fs/promises");
      const os = await import("os");
      const path = await import("path");
      const tmpFile = path.join(os.tmpdir(), `routa-pr-body-${cardId}.md`);
      await fs.writeFile(tmpFile, prBody, "utf-8");

      try {
        const ghArgs = [
          "pr", "create",
          "--title", shellEscape(prTitle),
          "--body-file", shellEscape(tmpFile),
          "--head", shellEscape(branch),
          ...(baseBranch ? ["--base", shellEscape(baseBranch)] : []),
        ];
        const ghCommand = ["gh", ...ghArgs].join(" ");

        const ghResult = await execCommand(ghCommand, cwd, 60_000);

        // gh pr create outputs the PR URL on success
        const prUrl = ghResult.stdout.trim().split("\n").pop()?.trim();

        if (!prUrl || !prUrl.startsWith("http")) {
          console.error(
            `[PrAutoCreate] Unexpected gh pr create output for task ${cardId}:`,
            ghResult.stdout,
            ghResult.stderr,
          );

          if (task) {
            task.lastSyncError = `Auto PR creation failed: ${
              ghResult.stderr?.trim() || "unexpected output"
            }`;
            task.updatedAt = new Date();
            await system.taskStore.save(task);
          }
          return;
        }

        // 5. Update the task with the PR URL
        if (task) {
          task.pullRequestUrl = prUrl;
          task.isPullRequest = true;
          task.lastSyncError = undefined;
          task.updatedAt = new Date();
          await system.taskStore.save(task);
        }

        console.log(
          `[PrAutoCreate] Created PR for task ${cardId}: ${prUrl}`,
        );
      } finally {
        // Always clean up the temp body file
        await fs.unlink(tmpFile).catch(() => {});
      }
    } catch (err) {
      console.error(
        `[PrAutoCreate] Failed to create PR for task ${cardId}:`,
        err,
      );

      // Store error on task so the UI surfaces it
      try {
        const task = await system.taskStore.get(cardId);
        if (task) {
          task.lastSyncError = `Auto PR creation failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          task.updatedAt = new Date();
          await system.taskStore.save(task);
        }
      } catch {
        // Best-effort error recording
      }
    }
  });
}
