import { v4 as uuidv4 } from "uuid";
import type { Task } from "../models/task";

export function buildTaskPrompt(task: Task): string {
  const labels = task.labels.length > 0 ? `Labels: ${task.labels.join(", ")}` : "Labels: none";
  return [
    `You are assigned to Kanban task: ${task.title}`,
    "",
    task.objective,
    "",
    `Priority: ${task.priority ?? "medium"}`,
    labels,
    task.githubUrl ? `GitHub Issue: ${task.githubUrl}` : "GitHub Issue: local-only",
    "",
    "Start implementation work immediately. Report progress in the session and keep changes focused on this task.",
  ].join("\n");
}

export async function triggerAssignedTaskAgent(params: {
  origin: string;
  workspaceId: string;
  cwd: string;
  branch?: string;
  task: Task;
}): Promise<{ sessionId?: string; error?: string }> {
  const { origin, workspaceId, cwd, branch, task } = params;
  const provider = task.assignedProvider ?? "opencode";
  const role = task.assignedRole ?? "CRAFTER";

  const newSessionResponse = await fetch(`${origin}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "session/new",
      params: {
        cwd,
        branch,
        provider,
        role,
        workspaceId,
        specialistId: task.assignedSpecialistId,
        name: `${task.title} · ${provider}`,
      },
    }),
  });

  const newSessionBody = await newSessionResponse.json() as { result?: { sessionId?: string }; error?: { message?: string } };
  const sessionId = newSessionBody.result?.sessionId;
  if (!newSessionResponse.ok || !sessionId) {
    return { error: newSessionBody.error?.message ?? "Failed to create ACP session." };
  }

  void fetch(`${origin}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "session/prompt",
      params: {
        sessionId,
        workspaceId,
        provider,
        cwd,
        prompt: [{ type: "text", text: buildTaskPrompt(task) }],
      },
    }),
  }).catch((error) => {
    console.error("[kanban] Failed to auto-prompt ACP task session:", error);
  });

  return { sessionId };
}