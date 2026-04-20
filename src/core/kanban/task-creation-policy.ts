export type TaskCreationSource = "manual" | "agent" | "api" | "session";

export function normalizeTaskCreationSource(
  value: unknown,
  options?: { sessionId?: string | null | undefined },
): TaskCreationSource {
  if (value === "manual" || value === "agent" || value === "session") {
    return value;
  }
  if (!value && options?.sessionId) {
    return "session";
  }
  return "api";
}

export function shouldCreateGitHubIssueOnTaskCreate(params: {
  createGitHubIssue: boolean;
  creationSource: TaskCreationSource;
}): boolean {
  return params.createGitHubIssue && params.creationSource === "manual";
}
