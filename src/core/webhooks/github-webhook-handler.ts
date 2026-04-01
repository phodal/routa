/**
 * GitHub Webhook Handler
 *
 * Core logic for:
 * 1. Verifying HMAC-SHA256 webhook signatures from GitHub
 * 2. Matching incoming events to user-configured trigger rules
 * 3. Building prompt strings and dispatching background tasks to ACP agents
 * 4. Triggering multi-step workflows when workflowId is configured
 * 5. Writing audit log entries
 *
 * This module is framework-agnostic — the Next.js route adapter calls it.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { v4 as uuidv4 } from "uuid";
import type {
  GitHubWebhookStore,
  GitHubWebhookConfig,
  WebhookTriggerLog,
} from "../store/github-webhook-store";
import type { BackgroundTaskStore } from "../store/background-task-store";
import { createBackgroundTask } from "../models/background-task";
import type { WorkflowRunStore } from "../workflows/workflow-store";
import { WorkflowExecutor } from "../workflows/workflow-executor";
import { getWorkflowLoader } from "../workflows/workflow-loader";
import {
  buildOwnershipRoutingContext,
  parseCodeownersContent,
  resolveOwnership,
} from "../harness/codeowners";
import type { OwnershipRoutingContext } from "../harness/codeowners-types";
import { parseReviewTriggerConfig } from "../harness/review-triggers";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitHubWebhookPayload {
  action?: string;
  issue?: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    labels?: Array<{ name: string }>;
    user?: { login: string };
  };
  pull_request?: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    state: string;
    user?: { login: string };
    head?: { ref: string; sha: string };
    base?: { ref: string };
    merged?: boolean;
    draft?: boolean;
  };
  check_run?: {
    name: string;
    status: string;
    conclusion?: string;
    html_url: string;
  };
  /** Check Suite event payload (check_suite event) */
  check_suite?: {
    id: number;
    status: string;
    conclusion?: string;
    head_branch?: string;
    head_sha?: string;
    url: string;
    pull_requests?: Array<{ number: number; url: string }>;
  };
  /** Workflow Run event payload (workflow_run event) */
  workflow_run?: {
    id: number;
    name: string;
    status: string;
    conclusion?: string;
    workflow_id: number;
    html_url: string;
    head_branch?: string;
    head_sha?: string;
    event: string;
    run_number: number;
    run_attempt: number;
  };
  /** Workflow Job event payload (workflow_job event) */
  workflow_job?: {
    id: number;
    name: string;
    status: string;
    conclusion?: string;
    html_url: string;
    started_at?: string;
    completed_at?: string;
    workflow_name?: string;
    runner_name?: string;
    steps?: Array<{ name: string; status: string; conclusion?: string }>;
  };
  /** PR Review event payload (pull_request_review event) */
  review?: {
    id: number;
    state: string; // "approved", "changes_requested", "commented", "dismissed"
    body?: string;
    html_url: string;
    user?: { login: string };
    commit_id?: string;
  };
  /** PR Review Comment event payload (pull_request_review_comment event) */
  comment?: {
    id: number;
    body: string;
    html_url: string;
    user?: { login: string };
    path?: string;
    line?: number;
    commit_id?: string;
  };
  /** Create/Delete event payload (create/delete events for tags and branches) */
  ref?: string;
  ref_type?: "branch" | "tag";
  master_branch?: string;
  pusher_type?: string;
  repository?: {
    full_name: string;
    html_url: string;
  };
  sender?: { login: string };
  [key: string]: unknown;
}

export interface HandleWebhookOptions {
  /** Value of X-GitHub-Event header */
  eventType: string;
  /** Value of X-Hub-Signature-256 header (may be undefined) */
  signature?: string;
  /** Raw request body as a Buffer or string (for signature verification) */
  rawBody: string | Buffer;
  /** Parsed JSON payload */
  payload: GitHubWebhookPayload;
  /** Webhook store (to look up configs and write logs) */
  webhookStore: GitHubWebhookStore;
  /** Background task store (to dispatch tasks) */
  backgroundTaskStore: BackgroundTaskStore;
  /** Workflow run store (for workflow execution) */
  workflowRunStore?: WorkflowRunStore;
  /** Fixed workspace ID for background tasks */
  workspaceId?: string;
}

export interface HandleWebhookResult {
  processed: number;
  skipped: number;
  logs: WebhookTriggerLog[];
}

// ─── Signature Verification ──────────────────────────────────────────────────

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 * Returns false if secret is empty (accepts all payloads — useful for dev).
 */
export function verifyGitHubSignature(
  secret: string,
  rawBody: string | Buffer,
  signature: string | undefined
): boolean {
  if (!secret) return true; // no secret configured → accept all
  if (!signature) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Event Filtering ──────────────────────────────────────────────────────────

/**
 * Check whether a config should fire for a given event.
 */
export function eventMatchesConfig(
  config: GitHubWebhookConfig,
  eventType: string,
  payload: GitHubWebhookPayload
): boolean {
  if (!config.enabled) return false;

  // Check event type match
  const eventBase = eventType; // e.g. "issues", "pull_request"
  if (!config.eventTypes.includes(eventBase) && !config.eventTypes.includes("*")) {
    return false;
  }

  // Label filter (only applies to issue events)
  if (config.labelFilter && config.labelFilter.length > 0) {
    const issueLabels = payload.issue?.labels?.map((l) => l.name) ?? [];
    const hasAnyLabel = config.labelFilter.some((lf) => issueLabels.includes(lf));
    if (!hasAnyLabel) return false;
  }

  return true;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

const DEFAULT_PROMPT_TEMPLATE = `A GitHub {{event}} event (action: {{action}}) was received on repository {{repo}}.

{{context}}

Please analyze this event and take appropriate action.`;

const CODEOWNERS_CANDIDATES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

export function buildPrompt(
  config: GitHubWebhookConfig,
  eventType: string,
  payload: GitHubWebhookPayload
): string {
  const template = config.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
  const action = payload.action ?? "unknown";
  const repo = payload.repository?.full_name ?? config.repo;

  // Build context section from payload
  const context = buildContextSection(eventType, payload);

  return template
    .replace(/\{\{event\}\}/g, eventType)
    .replace(/\{\{action\}\}/g, action)
    .replace(/\{\{repo\}\}/g, repo)
    .replace(/\{\{context\}\}/g, context)
    .replace(/\{\{payload\}\}/g, JSON.stringify(payload, null, 2));
}

function buildContextSection(eventType: string, payload: GitHubWebhookPayload): string {
  if (eventType === "issues" && payload.issue) {
    const issue = payload.issue;
    return [
      `Issue #${issue.number}: ${issue.title}`,
      `URL: ${issue.html_url}`,
      issue.body ? `\nDescription:\n${issue.body}` : "",
      issue.labels?.length
        ? `Labels: ${issue.labels.map((l) => l.name).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if ((eventType === "pull_request" || eventType === "pull_request_review" || eventType === "pull_request_review_comment") && payload.pull_request) {
    const pr = payload.pull_request;
    const lines = [
      `PR #${pr.number}: ${pr.title}`,
      `URL: ${pr.html_url}`,
      `Branch: ${pr.head?.ref ?? "unknown"} → ${pr.base?.ref ?? "unknown"}`,
      pr.draft ? `Status: Draft` : pr.merged ? `Status: Merged` : `Status: ${pr.state}`,
      pr.body ? `\nDescription:\n${pr.body}` : "",
    ];

    // Add review info for pull_request_review event
    if (eventType === "pull_request_review" && payload.review) {
      const review = payload.review;
      lines.push(`\nReview by ${review.user?.login ?? "unknown"}: ${review.state}`);
      if (review.body) lines.push(`Review comment:\n${review.body}`);
    }

    // Add comment info for pull_request_review_comment event
    if (eventType === "pull_request_review_comment" && payload.comment) {
      const comment = payload.comment;
      lines.push(`\nComment by ${comment.user?.login ?? "unknown"}`);
      if (comment.path) lines.push(`File: ${comment.path}${comment.line ? `:${comment.line}` : ""}`);
      lines.push(`Comment:\n${comment.body}`);
    }

    return lines.filter(Boolean).join("\n");
  }

  if (eventType === "check_run" && payload.check_run) {
    const cr = payload.check_run;
    return [
      `Check: ${cr.name}`,
      `Status: ${cr.status}, Conclusion: ${cr.conclusion ?? "pending"}`,
      `URL: ${cr.html_url}`,
    ].join("\n");
  }

  // Check Suite event
  if (eventType === "check_suite" && payload.check_suite) {
    const cs = payload.check_suite;
    const lines = [
      `Check Suite #${cs.id}`,
      `Status: ${cs.status}, Conclusion: ${cs.conclusion ?? "pending"}`,
      cs.head_branch ? `Branch: ${cs.head_branch}` : "",
      cs.head_sha ? `Commit: ${cs.head_sha.slice(0, 7)}` : "",
      cs.pull_requests?.length
        ? `PRs: ${cs.pull_requests.map((pr) => `#${pr.number}`).join(", ")}`
        : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  // Workflow Run event
  if (eventType === "workflow_run" && payload.workflow_run) {
    const wr = payload.workflow_run;
    return [
      `Workflow: ${wr.name} (#${wr.run_number})`,
      `Status: ${wr.status}, Conclusion: ${wr.conclusion ?? "pending"}`,
      `Triggered by: ${wr.event}`,
      wr.head_branch ? `Branch: ${wr.head_branch}` : "",
      wr.head_sha ? `Commit: ${wr.head_sha.slice(0, 7)}` : "",
      `URL: ${wr.html_url}`,
      `Attempt: ${wr.run_attempt}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Workflow Job event
  if (eventType === "workflow_job" && payload.workflow_job) {
    const wj = payload.workflow_job;
    const lines = [
      `Job: ${wj.name}${wj.workflow_name ? ` (${wj.workflow_name})` : ""}`,
      `Status: ${wj.status}, Conclusion: ${wj.conclusion ?? "pending"}`,
      `URL: ${wj.html_url}`,
      wj.runner_name ? `Runner: ${wj.runner_name}` : "",
    ];
    if (wj.steps?.length) {
      const failed = wj.steps.filter((s) => s.conclusion === "failure");
      if (failed.length > 0) {
        lines.push(`\nFailed steps: ${failed.map((s) => s.name).join(", ")}`);
      }
    }
    return lines.filter(Boolean).join("\n");
  }

  // Create event (tags and branches)
  if (eventType === "create" && payload.ref && payload.ref_type) {
    return [
      `Created ${payload.ref_type}: ${payload.ref}`,
      payload.master_branch ? `Default branch: ${payload.master_branch}` : "",
      payload.sender ? `By: ${payload.sender.login}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Delete event (tags and branches)
  if (eventType === "delete" && payload.ref && payload.ref_type) {
    return [
      `Deleted ${payload.ref_type}: ${payload.ref}`,
      payload.sender ? `By: ${payload.sender.login}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return JSON.stringify(payload, null, 2).slice(0, 1000);
}

async function fetchGitHubJson<T>(url: string, token: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function fetchRepoTextFile(
  repo: string,
  filePath: string,
  token: string,
  ref?: string,
): Promise<string | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const payload = await fetchGitHubJson<{
    content?: string;
    encoding?: string;
  }>(`https://api.github.com/repos/${repo}/contents/${filePath}${query}`, token);

  if (!payload?.content) {
    return null;
  }

  if ((payload.encoding ?? "").toLowerCase() === "base64") {
    return Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf-8");
  }

  return payload.content;
}

async function fetchFirstRepoTextFile(
  repo: string,
  filePaths: string[],
  token: string,
  ref?: string,
): Promise<string | null> {
  for (const filePath of filePaths) {
    const content = await fetchRepoTextFile(repo, filePath, token, ref);
    if (content !== null) {
      return content;
    }
  }
  return null;
}

async function fetchPullRequestFiles(
  repo: string,
  pullNumber: number,
  token: string,
): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const payload = await fetchGitHubJson<Array<{ filename?: string }>>(
      `https://api.github.com/repos/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      token,
    );
    if (!payload || payload.length === 0) {
      break;
    }
    for (const file of payload) {
      if (typeof file.filename === "string" && file.filename.length > 0) {
        files.push(file.filename);
      }
    }
    if (payload.length < 100) {
      break;
    }
  }
  return [...new Set(files)];
}

async function resolveWebhookChangedFiles(
  config: GitHubWebhookConfig,
  payload: GitHubWebhookPayload,
): Promise<string[]> {
  if (payload.comment?.path) {
    return [payload.comment.path];
  }

  const repo = payload.repository?.full_name ?? config.repo;
  const pullNumber = payload.pull_request?.number;
  if (!repo || !pullNumber || !config.githubToken) {
    return [];
  }

  return fetchPullRequestFiles(repo, pullNumber, config.githubToken);
}

function summarizeRoutingList(values: string[], maxItems = 4): string {
  if (values.length === 0) {
    return "none";
  }
  if (values.length <= maxItems) {
    return values.join(", ");
  }
  return `${values.slice(0, maxItems).join(", ")}, +${values.length - maxItems} more`;
}

function renderOwnershipRoutingContext(ownershipRouting: OwnershipRoutingContext): string {
  return [
    "Ownership routing context:",
    `Touched owners: ${summarizeRoutingList(ownershipRouting.touchedOwners)}`,
    `Unowned changed files: ${summarizeRoutingList(ownershipRouting.unownedChangedFiles)}`,
    `Overlapping ownership: ${summarizeRoutingList(ownershipRouting.overlappingChangedFiles)}`,
    `High-risk unowned files: ${summarizeRoutingList(ownershipRouting.highRiskUnownedFiles)}`,
    `Cross-owner triggers: ${summarizeRoutingList(ownershipRouting.crossOwnerTriggers)}`,
  ].join("\n");
}

async function buildWebhookOwnershipRouting(
  config: GitHubWebhookConfig,
  payload: GitHubWebhookPayload,
): Promise<OwnershipRoutingContext | null> {
  const repo = payload.repository?.full_name ?? config.repo;
  if (!repo || !config.githubToken) {
    return null;
  }

  const changedFiles = await resolveWebhookChangedFiles(config, payload);
  if (changedFiles.length === 0) {
    return null;
  }

  const ref = payload.pull_request?.base?.ref;
  const codeownersContent = await fetchFirstRepoTextFile(repo, CODEOWNERS_CANDIDATES, config.githubToken, ref);
  const reviewTriggerContent = await fetchRepoTextFile(repo, "docs/fitness/review-triggers.yaml", config.githubToken, ref);
  const codeownersRules = codeownersContent ? parseCodeownersContent(codeownersContent).rules : [];
  const triggerRules = reviewTriggerContent ? parseReviewTriggerConfig(reviewTriggerContent) : [];
  const matches = resolveOwnership(changedFiles, codeownersRules);

  return buildOwnershipRoutingContext({
    changedFiles,
    matches,
    triggerRules,
  });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleGitHubWebhook(
  opts: HandleWebhookOptions
): Promise<HandleWebhookResult> {
  const {
    eventType,
    signature,
    rawBody,
    payload,
    webhookStore,
    backgroundTaskStore,
    workflowRunStore,
    workspaceId,
  } = opts;

  const logs: WebhookTriggerLog[] = [];
  let processed = 0;
  let skipped = 0;

  // Load all enabled configs
  const configs = await webhookStore.listConfigs();

  for (const config of configs) {
    // 1. Verify signature
    const signatureValid = verifyGitHubSignature(
      config.webhookSecret,
      rawBody,
      signature
    );

    if (!signatureValid) {
      const log = await webhookStore.appendLog({
        configId: config.id,
        eventType,
        eventAction: payload.action,
        payload,
        signatureValid: false,
        outcome: "error",
        errorMessage: "Webhook signature verification failed",
      });
      logs.push(log);
      skipped++;
      continue;
    }

    // 2. Check if this config matches the event
    if (!eventMatchesConfig(config, eventType, payload)) {
      skipped++;
      continue;
    }

    // 3. Dispatch: workflow trigger or single background task
    try {
      const configWorkspaceId = config.workspaceId ?? workspaceId;
      if (!configWorkspaceId) {
        const log = await webhookStore.appendLog({
          configId: config.id,
          eventType,
          eventAction: payload.action,
          payload,
          signatureValid: true,
          outcome: "error",
          errorMessage: "No workspaceId configured for webhook dispatch",
        });
        logs.push(log);
        skipped++;
        continue;
      }
      let taskId: string | undefined;
      let workflowRunId: string | undefined;

      // If workflowId is configured and workflowRunStore is available, trigger workflow
      if (config.workflowId && workflowRunStore) {
        const result = await triggerWorkflowForWebhook({
          workflowId: config.workflowId,
          workspaceId: configWorkspaceId,
          eventType,
          payload,
          config,
          backgroundTaskStore,
          workflowRunStore,
        });
        workflowRunId = result.workflowRunId;
        taskId = result.taskIds[0]; // First task for logging
      } else {
        // Fallback to single background task
        const ownershipRouting = await buildWebhookOwnershipRouting(config, payload).catch(() => null);
        const prompt = [
          buildPrompt(config, eventType, payload),
          ownershipRouting ? renderOwnershipRoutingContext(ownershipRouting) : "",
        ].filter(Boolean).join("\n\n");
        const taskTitle = `[GitHub ${eventType}] ${payload.repository?.full_name ?? config.repo} — ${payload.action ?? "event"}`;

        const task = createBackgroundTask({
          id: uuidv4(),
          prompt,
          agentId: config.triggerAgentId,
          workspaceId: configWorkspaceId,
          title: taskTitle,
          triggerSource: "webhook",
          triggeredBy: `github:${eventType}`,
          maxAttempts: 1,
        });

        await backgroundTaskStore.save(task);
        taskId = task.id;
      }

      const log = await webhookStore.appendLog({
        configId: config.id,
        eventType,
        eventAction: payload.action,
        payload,
        backgroundTaskId: taskId,
        workflowRunId,
        signatureValid: true,
        outcome: "triggered",
      });
      logs.push(log);
      processed++;
    } catch (err) {
      const log = await webhookStore.appendLog({
        configId: config.id,
        eventType,
        eventAction: payload.action,
        payload,
        signatureValid: true,
        outcome: "error",
        errorMessage: String(err),
      });
      logs.push(log);
      skipped++;
    }
  }

  return { processed, skipped, logs };
}

// ─── Workflow Trigger Helper ─────────────────────────────────────────────────

interface TriggerWorkflowForWebhookInput {
  workflowId: string;
  workspaceId: string;
  eventType: string;
  payload: GitHubWebhookPayload;
  config: GitHubWebhookConfig;
  backgroundTaskStore: BackgroundTaskStore;
  workflowRunStore: WorkflowRunStore;
}

async function triggerWorkflowForWebhook(
  input: TriggerWorkflowForWebhookInput
): Promise<{ workflowRunId: string; taskIds: string[] }> {
  const { workflowId, workspaceId, eventType, payload, config, backgroundTaskStore, workflowRunStore } = input;

  // Load workflow definition
  const loader = getWorkflowLoader();
  const definition = await loader.load(workflowId);

  const ownershipRouting = await buildWebhookOwnershipRouting(config, payload).catch(() => null);

  // Build trigger payload as JSON string
  const triggerPayload = JSON.stringify({
    event: eventType,
    action: payload.action,
    repository: payload.repository?.full_name,
    pull_request: payload.pull_request ? {
      number: payload.pull_request.number,
      title: payload.pull_request.title,
      body: payload.pull_request.body,
      html_url: payload.pull_request.html_url,
      user: payload.pull_request.user?.login,
      head: payload.pull_request.head?.ref,
      base: payload.pull_request.base?.ref,
    } : undefined,
    issue: payload.issue ? {
      number: payload.issue.number,
      title: payload.issue.title,
      body: payload.issue.body,
      html_url: payload.issue.html_url,
      labels: payload.issue.labels?.map(l => l.name),
    } : undefined,
    sender: payload.sender?.login,
    ownershipRouting,
  }, null, 2);

  // Create workflow executor and trigger
  const executor = new WorkflowExecutor({
    workflowRunStore,
    backgroundTaskStore,
  });

  const result = await executor.trigger({
    workflowId,
    definition,
    workspaceId,
    triggerPayload,
    triggerSource: "webhook",
  });

  console.log(`[Webhook] Triggered workflow "${workflowId}" → run ${result.workflowRunId}, ${result.taskIds.length} tasks`);

  return result;
}

// ─── GitHub Repository Hooks API ─────────────────────────────────────────────

/**
 * Register a webhook on a GitHub repository using the GitHub API.
 * Requires a token with admin:repo_hook or repo scope.
 */
export async function registerGitHubWebhook(opts: {
  token: string;
  repo: string; // "owner/repo"
  webhookUrl: string;
  secret: string;
  events: string[];
}): Promise<{ id: number; url: string }> {
  const { token, repo, webhookUrl, secret, events } = opts;
  const apiUrl = `https://api.github.com/repos/${repo}/hooks`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      name: "web",
      active: true,
      events,
      config: {
        url: webhookUrl,
        content_type: "json",
        secret,
        insecure_ssl: "0",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { id: number; config: { url: string } };
  return { id: data.id, url: data.config.url };
}

/**
 * Delete a webhook from a GitHub repository.
 */
export async function deleteGitHubWebhook(opts: {
  token: string;
  repo: string;
  hookId: number;
}): Promise<void> {
  const { token, repo, hookId } = opts;
  const apiUrl = `https://api.github.com/repos/${repo}/hooks/${hookId}`;

  const response = await fetch(apiUrl, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }
}

/**
 * List webhooks for a GitHub repository.
 */
export async function listGitHubWebhooks(opts: {
  token: string;
  repo: string;
}): Promise<Array<{ id: number; events: string[]; active: boolean; config: { url: string } }>> {
  const { token, repo } = opts;
  const apiUrl = `https://api.github.com/repos/${repo}/hooks`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  return response.json();
}
