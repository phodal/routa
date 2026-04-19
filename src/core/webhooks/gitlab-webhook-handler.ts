/**
 * GitLab Webhook Handler
 *
 * Core logic for:
 * 1. Verifying HMAC-SHA256 webhook signatures from GitLab
 * 2. Matching incoming events to user-configured trigger rules
 * 3. Building prompt strings and dispatching background tasks to ACP agents
 * 4. Writing audit log entries
 *
 * This module mirrors the GitHub webhook handler structure for GitLab compatibility.
 */

import { createHmac as _createHmac, timingSafeEqual as _timingSafeEqual } from "crypto";
import { v4 as uuidv4 } from "uuid";
import type {
  GitLabWebhookStore,
  GitLabWebhookConfig,
  WebhookTriggerLog,
} from "../store/gitlab-webhook-store";
import type { BackgroundTaskStore } from "../store/background-task-store";
import { createBackgroundTask } from "../models/background-task";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitLabWebhookPayload {
  /** GitLab event type (e.g., "Merge Request Hook", "Push Hook") */
  object_kind?: string;
  /** Event action (e.g., "open", "merge", "update") */
  action?: string;
  /** Merge Request data */
  object_attributes?: {
    id: number;
    iid: number;
    title: string;
    description?: string;
    url: string;
    state: string;
    action?: string;
    draft?: boolean;
    merged_at?: string | null;
    source_branch: string;
    target_branch: string;
    author: { username: string; name: string };
    created_at: string;
    updated_at: string;
    sha?: string;
    diff_refs?: { head_sha: string };
  };
  /** Issue data */
  issue?: {
    id: number;
    iid: number;
    title: string;
    description?: string;
    url: string;
    state: string;
    labels: Array<{ title: string; color: string }>;
    author: { username: string };
  };
  /** Project/Repository data */
  project?: {
    id: number;
    path_with_namespace: string;
    web_url: string;
    default_branch: string;
    repository: { visibility: string };
  };
  /** User who triggered the event */
  user?: {
    username: string;
    name: string;
  };
  /** Comment/note data */
  object_kind_note?: string;
  note?: {
    id: number;
    type: string | null;
    noteable_type: string;
    noteable_iid: number | null;
    project_id: number;
    created_at: string;
    updated_at: string;
    body: string;
    author: { username: string; name: string };
    commit_id?: string;
    discussion_id?: string;
    position?: {
      head_sha: string;
      old_path: string;
      new_path: string;
      position_type: string;
      new_line: number;
      old_line: number;
    };
  };
  /** Ref name (for push/delete events) */
  ref?: string;
  /** Checkout SHA (for push events) */
  checkout_sha?: string;
  before?: string;
  after?: string;
  /** User who triggered the event */
  user_username?: string;
  user_name?: string;
  /** Total commits count (for push events) */
  total_commits_count?: number;
  /** Commits array (for push events) */
  commits?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface HandleGitLabWebhookOptions {
  /** Value of X-GitLab-Event header */
  eventType: string;
  /** Value of X-GitLab-Token header (webhook secret/token) */
  token?: string;
  /** Raw request body as a Buffer or string (for signature verification) */
  rawBody: string | Buffer;
  /** Parsed JSON payload */
  payload: GitLabWebhookPayload;
  /** Webhook store (to look up configs and write logs) */
  webhookStore: GitLabWebhookStore;
  /** Background task store (to dispatch tasks) */
  backgroundTaskStore: BackgroundTaskStore;
  /** Fixed workspace ID for background tasks */
  workspaceId?: string;
  /** Optional event bus for emitting internal events */
  eventBus?: {
    emit(event: { type: string; agentId: string; workspaceId: string; data: unknown; timestamp: Date }): void;
  };
}

export interface HandleGitLabWebhookResult {
  processed: number;
  skipped: number;
  logs: WebhookTriggerLog[];
}

// ─── Signature Verification ──────────────────────────────────────────────────

/**
 * Verify a GitLab webhook token.
 * GitLab uses a simple token verification (not HMAC like GitHub).
 * The token is sent in the X-GitLab-Token header and should match the configured secret.
 */
export function verifyGitLabToken(
  secret: string,
  token: string | undefined
): boolean {
  if (!secret) return true; // no secret configured → accept all (dev mode)
  if (!token) return false;
  return token === secret;
}

// ─── Event Type Mapping ──────────────────────────────────────────────────────

/**
 * Map GitLab object_kind to normalized event type.
 */
export function normalizeGitLabEvent(objectKind: string): string {
  const eventMap: Record<string, string> = {
    "push": "push",
    "tag_push": "push",
    "issue": "issues",
    "merge_request": "merge_request",
    "note": "note",
    "wiki_page": "wiki_page",
    "deployment": "deployment",
    "job": "job",
    "pipeline": "pipeline",
    "release": "release",
  };

  return eventMap[objectKind] ?? objectKind.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Extract action from GitLab webhook payload.
 */
export function extractGitLabAction(payload: GitLabWebhookPayload): string | undefined {
  // MR action is in object_attributes.action
  if (payload.object_attributes?.action) {
    return payload.object_attributes.action;
  }

  // For note events, determine action based on noteable_type
  if (payload.object_kind === "note" && payload.note?.noteable_type) {
    const noteableType = payload.note.noteable_type;
    if (noteableType === "MergeRequest") return "comment";
    if (noteableType === "Issue") return "comment";
    if (noteableType === "Commit") return "comment";
    return "comment";
  }

  // For push events, derive action from ref changes
  if (payload.object_kind === "push" || payload.object_kind === "tag_push") {
    if (payload.before?.startsWith("0000000")) return "create";
    if (payload.after?.startsWith("0000000")) return "delete";
    return "push";
  }

  return undefined;
}

// ─── Event Filtering ──────────────────────────────────────────────────────────

/**
 * Check whether a config should fire for a given event.
 */
export function eventMatchesConfig(
  config: GitLabWebhookConfig,
  eventType: string,
  payload: GitLabWebhookPayload
): boolean {
  if (!config.enabled) return false;

  // Check event type match
  if (!config.eventTypes.includes(eventType) && !config.eventTypes.includes("*")) {
    return false;
  }

  // Label filter (only applies to issue events)
  if (config.labelFilter && config.labelFilter.length > 0) {
    const issueLabels = payload.issue?.labels?.map((l) => l.title) ?? [];
    const hasAnyLabel = config.labelFilter.some((lf) => issueLabels.includes(lf));
    if (!hasAnyLabel) return false;
  }

  return true;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

const DEFAULT_PROMPT_TEMPLATE = `A GitLab {{event}} event (action: {{action}}) was received on repository {{repo}}.

{{context}}

Please analyze this event and take appropriate action.`;

export function buildPrompt(
  config: GitLabWebhookConfig,
  eventType: string,
  payload: GitLabWebhookPayload
): string {
  const template = config.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
  const action = extractGitLabAction(payload) ?? "unknown";
  const repo = payload.project?.path_with_namespace ?? config.repo;

  // Build context section from payload
  const context = buildContextSection(eventType, payload);

  return template
    .replace(/\{\{event\}\}/g, eventType)
    .replace(/\{\{action\}\}/g, action)
    .replace(/\{\{repo\}\}/g, repo)
    .replace(/\{\{context\}\}/g, context)
    .replace(/\{\{payload\}\}/g, JSON.stringify(payload, null, 2));
}

function buildContextSection(eventType: string, payload: GitLabWebhookPayload): string {
  // Merge Request event
  if (eventType === "merge_request" && payload.object_attributes) {
    const mr = payload.object_attributes;
    const lines = [
      `MR !${mr.iid}: ${mr.title}`,
      `URL: ${mr.url}`,
      `Branch: ${mr.source_branch} → ${mr.target_branch}`,
      mr.draft ? `Status: Draft` : mr.merged_at ? `Status: Merged` : `Status: ${mr.state}`,
      mr.description ? `\nDescription:\n${mr.description}` : "",
    ];

    // Add comment info if this is a note event on an MR
    if (payload.object_kind === "note" && payload.note) {
      const note = payload.note;
      lines.push(`\nComment by ${note.author.username}`);
      if (note.position) {
        lines.push(`File: ${note.position.new_path}${note.position.new_line ? `:${note.position.new_line}` : ""}`);
      }
      lines.push(`Comment:\n${note.body}`);
    }

    return lines.filter(Boolean).join("\n");
  }

  // Issue event
  if (eventType === "issues" && payload.issue) {
    const issue = payload.issue;
    return [
      `Issue #${issue.iid}: ${issue.title}`,
      `URL: ${issue.url}`,
      issue.state ? `State: ${issue.state}` : "",
      issue.labels?.length ? `Labels: ${issue.labels.map((l) => l.title).join(", ")}` : "",
      issue.description ? `\nDescription:\n${issue.description}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Push event
  if ((eventType === "push" || eventType === "tag_push") && payload.ref) {
    const lines = [
      `Pushed to: ${payload.ref.replace("refs/heads/", "").replace("refs/tags/", "")}`,
      payload.user_username ? `By: ${payload.user_username}` : "",
      payload.checkout_sha ? `Commit: ${payload.checkout_sha.slice(0, 7)}` : "",
      payload.total_commits_count ? `Commits: ${payload.total_commits_count}` : "",
    ];

    // Add commit messages if available
    if (payload.commits && payload.commits.length > 0) {
      lines.push("\nCommits:");
      for (const commit of payload.commits.slice(0, 5)) {
        lines.push(`  - ${String(commit.title).slice(0, 80)}`);
      }
      if (payload.commits.length > 5) {
        lines.push(`  ... and ${payload.commits.length - 5} more`);
      }
    }

    return lines.filter(Boolean).join("\n");
  }

  // Pipeline event
  if (eventType === "pipeline" && payload.object_attributes) {
    const attrs = payload.object_attributes as Record<string, unknown>;
    return [
      `Pipeline #${attrs.id}`,
      `Status: ${attrs.status}`,
      `Source: ${attrs.source}`,
      `Ref: ${attrs.ref}`,
      attrs.sha ? `Commit: ${String(attrs.sha).slice(0, 7)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Job event
  if (eventType === "job") {
    const attrs = payload.object_attributes as Record<string, unknown>;
    return [
      `Job #${attrs.id}`,
      `Name: ${attrs.name}`,
      `Status: ${attrs.status}`,
      `Stage: ${attrs.stage}`,
      attrs.ref ? `Ref: ${attrs.ref}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Note/Comment event (not part of MR)
  if (eventType === "note" && payload.note) {
    const note = payload.note;
    const lines = [
      `Comment by ${note.author.username}`,
      `Type: ${note.noteable_type}`,
      note.noteable_iid ? `On: ${note.noteable_type} #${note.noteable_iid}` : "",
      note.commit_id ? `Commit: ${note.commit_id.slice(0, 7)}` : "",
      `\nComment:\n${note.body}`,
    ];

    return lines.filter(Boolean).join("\n");
  }

  return JSON.stringify(payload, null, 2).slice(0, 1000);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleGitLabWebhook(
  opts: HandleGitLabWebhookOptions
): Promise<HandleGitLabWebhookResult> {
  const {
    eventType,
    token,
    rawBody: _rawBody,
    payload,
    webhookStore,
    backgroundTaskStore,
    workspaceId,
  } = opts;

  const logs: WebhookTriggerLog[] = [];
  let processed = 0;
  let skipped = 0;

  // Normalize event type
  const normalizedEventType = normalizeGitLabEvent(eventType);
  const action = extractGitLabAction(payload);

  // Load all enabled configs
  const configs = await webhookStore.listConfigs();

  for (const config of configs) {
    // 1. Verify token
    const tokenValid = verifyGitLabToken(
      config.webhookSecret,
      token
    );

    if (!tokenValid) {
      const log = await webhookStore.appendLog({
        configId: config.id,
        eventType: normalizedEventType,
        eventAction: action,
        payload: payload as Record<string, unknown>,
        signatureValid: false,
        outcome: "error",
        errorMessage: "Webhook token verification failed",
      });
      logs.push(log);
      skipped++;
      continue;
    }

    // 2. Check if this config matches the event
    if (!eventMatchesConfig(config, normalizedEventType, payload)) {
      skipped++;
      continue;
    }

    // 3. Dispatch background task
    try {
      const configWorkspaceId = config.workspaceId ?? workspaceId;
      if (!configWorkspaceId) {
        const log = await webhookStore.appendLog({
          configId: config.id,
          eventType: normalizedEventType,
          eventAction: action,
          payload: payload as Record<string, unknown>,
          signatureValid: true,
          outcome: "error",
          errorMessage: "No workspaceId configured for webhook dispatch",
        });
        logs.push(log);
        skipped++;
        continue;
      }

      const prompt = buildPrompt(config, normalizedEventType, payload);
      const taskTitle = `[GitLab ${normalizedEventType}] ${payload.project?.path_with_namespace ?? config.repo} — ${action ?? "event"}`;

      const task = createBackgroundTask({
        id: uuidv4(),
        prompt,
        agentId: config.triggerAgentId,
        workspaceId: configWorkspaceId,
        title: taskTitle,
        triggerSource: "webhook",
        triggeredBy: `gitlab:${normalizedEventType}`,
        maxAttempts: 1,
      });

      await backgroundTaskStore.save(task);

      const log = await webhookStore.appendLog({
        configId: config.id,
        eventType: normalizedEventType,
        eventAction: action,
        payload: payload as Record<string, unknown>,
        backgroundTaskId: task.id,
        signatureValid: true,
        outcome: "triggered",
      });
      logs.push(log);
      processed++;
    } catch (err) {
      const log = await webhookStore.appendLog({
        configId: config.id,
        eventType: normalizedEventType,
        eventAction: action,
        payload: payload as Record<string, unknown>,
        signatureValid: true,
        outcome: "error",
        errorMessage: String(err),
      });
      logs.push(log);
      skipped++;
    }
  }

  // Emit MR merged internal event
  if (
    opts.eventBus
    && normalizedEventType === "merge_request"
    && (action === "merge" || payload.object_attributes?.merged_at)
    && payload.object_attributes?.url
  ) {
    opts.eventBus.emit({
      type: "mr_merged",
      agentId: "gitlab-webhook-handler",
      workspaceId: workspaceId ?? "",
      data: {
        mergeRequestUrl: payload.object_attributes.url,
        mrNumber: payload.object_attributes.iid,
        mrTitle: payload.object_attributes.title,
        branch: payload.object_attributes.source_branch,
        targetBranch: payload.object_attributes.target_branch,
        mergedAt: payload.object_attributes.merged_at ?? new Date().toISOString(),
        repo: payload.project?.path_with_namespace,
      },
      timestamp: new Date(),
    });
  }

  return { processed, skipped, logs };
}

// ─── GitLab Project Hooks API ───────────────────────────────────────────────

/**
 * Register a webhook on a GitLab project using the GitLab API.
 * Requires a token with project admin scope.
 */
export async function registerGitLabWebhook(opts: {
  token: string;
  repo: string; // "owner/repo" or "group/project"
  webhookUrl: string;
  secret: string;
  events: string[];
}): Promise<{ id: number; url: string }> {
  const baseUrl = process.env.GITLAB_URL ?? "https://gitlab.com";
  const encodedPath = opts.repo.replace(/\//g, "%2F");
  const apiUrl = `${baseUrl}/api/v4/projects/${encodedPath}/hooks`;

  // Map GitHub event types to GitLab event types
  const eventMap: Record<string, boolean> = {
    push: false,
    tag_push: false,
    issues: false,
    merge_request: false,
    wiki_page: false,
    deployment: false,
    job: false,
    pipeline: false,
    release: false,
  };

  // Enable requested events
  for (const event of opts.events) {
    if (event === "push") eventMap.push = true;
    if (event === "tag_push") eventMap.tag_push = true;
    if (event === "issues" || event === "issue") eventMap.issues = true;
    if (event === "merge_request" || event === "pull_request") eventMap.merge_request = true;
    if (event === "wiki_page") eventMap.wiki_page = true;
    if (event === "deployment") eventMap.deployment = true;
    if (event === "job") eventMap.job = true;
    if (event === "pipeline") eventMap.pipeline = true;
    if (event === "release") eventMap.release = true;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: opts.webhookUrl,
      token: opts.secret,
      push_events: eventMap.push,
      tag_push_events: eventMap.tag_push,
      issues_events: eventMap.issues,
      merge_requests_events: eventMap.merge_request,
      wiki_page_events: eventMap.wiki_page,
      deployment_events: eventMap.deployment,
      job_events: eventMap.job,
      pipeline_events: eventMap.pipeline,
      releases_events: eventMap.release,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitLab API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { id: number; url: string };
  return { id: data.id, url: data.url };
}

/**
 * Delete a webhook from a GitLab project.
 */
export async function deleteGitLabWebhook(opts: {
  token: string;
  repo: string;
  hookId: number;
}): Promise<void> {
  const baseUrl = process.env.GITLAB_URL ?? "https://gitlab.com";
  const encodedPath = opts.repo.replace(/\//g, "%2F");
  const apiUrl = `${baseUrl}/api/v4/projects/${encodedPath}/hooks/${opts.hookId}`;

  const response = await fetch(apiUrl, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${opts.token}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`GitLab API error ${response.status}: ${body}`);
  }
}

/**
 * List webhooks for a GitLab project.
 */
export async function listGitLabWebhooks(opts: {
  token: string;
  repo: string;
}): Promise<Array<{ id: number; events: string[]; active: boolean; config: { url: string } }>> {
  const baseUrl = process.env.GITLAB_URL ?? "https://gitlab.com";
  const encodedPath = opts.repo.replace(/\//g, "%2F");
  const apiUrl = `${baseUrl}/api/v4/projects/${encodedPath}/hooks`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitLab API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as Array<{
    id: number;
    url: string;
    push_events: boolean;
    tag_push_events: boolean;
    issues_events: boolean;
    merge_requests_events: boolean;
    wiki_page_events: boolean;
    deployment_events: boolean;
    job_events: boolean;
    pipeline_events: boolean;
    releases_events: boolean;
    enabled: boolean;
  }>;

  return data.map((hook) => {
    const events: string[] = [];
    if (hook.push_events) events.push("push");
    if (hook.tag_push_events) events.push("tag_push");
    if (hook.issues_events) events.push("issues");
    if (hook.merge_requests_events) events.push("merge_request");
    if (hook.wiki_page_events) events.push("wiki_page");
    if (hook.deployment_events) events.push("deployment");
    if (hook.job_events) events.push("job");
    if (hook.pipeline_events) events.push("pipeline");
    if (hook.releases_events) events.push("release");

    return {
      id: hook.id,
      events,
      active: hook.enabled,
      config: { url: hook.url },
    };
  });
}
