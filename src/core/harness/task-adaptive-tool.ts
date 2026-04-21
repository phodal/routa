import {
  normalizeContextValue,
  resolveRepoRoot,
  type HarnessContext,
} from "@/core/harness/context-resolution";
import {
  assembleTaskAdaptiveHarness,
  parseTaskAdaptiveHarnessOptions,
  type TaskAdaptiveHarnessPack,
} from "@/core/harness/task-adaptive";

export const TASK_ADAPTIVE_HARNESS_TOOL_NAME = "assemble_task_adaptive_harness";

export async function assembleTaskAdaptiveHarnessFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<TaskAdaptiveHarnessPack> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  return assembleTaskAdaptiveHarness(repoRoot, options);
}
