export type GitHubWorkflowCategory = "Validation" | "Release" | "Automation" | "Maintenance";

export type GitHubWorkflowSummary = {
  name: string;
  event: string;
  relativePath?: string | null;
};

const RELEASE_KEYWORDS = ["release", "publish", "deploy", "pages", "ship"];
const MAINTENANCE_KEYWORDS = [
  "cleanup",
  "collector",
  "garbage",
  "hygiene",
  "repair",
  "fixer",
  "delete merged branches",
];
const AUTOMATION_KEYWORDS = ["issue", "copilot", "enricher", "bot", "handler"];
const VALIDATION_EVENTS = [
  "pull_request",
  "pull_request_target",
  "push",
  "workflow_run",
  "merge_group",
  "workflow_call",
];
const AUTOMATION_EVENTS = [
  "issues",
  "issue",
  "issue_comment",
  "discussion",
  "repository_dispatch",
];

export function normalizeGitHubWorkflowEventTokens(event: string): string[] {
  return event
    .toLowerCase()
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function includesKeyword(values: string[], keywords: readonly string[]) {
  return keywords.some((keyword) => values.some((value) => value.includes(keyword)));
}

function buildSearchFields(flow: GitHubWorkflowSummary) {
  return [
    flow.name.toLowerCase(),
    (flow.relativePath ?? "").toLowerCase(),
  ];
}

export function classifyGitHubWorkflowCategory(flow: GitHubWorkflowSummary): GitHubWorkflowCategory {
  const eventTokens = normalizeGitHubWorkflowEventTokens(flow.event);
  const eventString = eventTokens.join(",");
  const searchFields = buildSearchFields(flow);
  const hasEvent = (value: string) => eventString.includes(value);

  if (includesKeyword(searchFields, RELEASE_KEYWORDS)) {
    return "Release";
  }

  if (eventTokens.length === 1 && eventTokens[0] === "schedule") {
    return "Maintenance";
  }

  if (hasEvent("schedule") || includesKeyword(searchFields, MAINTENANCE_KEYWORDS)) {
    return "Maintenance";
  }

  if (
    AUTOMATION_EVENTS.some((value) => hasEvent(value))
    || includesKeyword(searchFields, AUTOMATION_KEYWORDS)
  ) {
    return "Automation";
  }

  if (VALIDATION_EVENTS.some((value) => hasEvent(value))) {
    return "Validation";
  }

  return "Automation";
}
