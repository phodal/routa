/**
 * GitLab Polling Adapter
 *
 * Alternative to webhooks for local development and environments without public IP.
 * Periodically polls GitLab Events API to detect changes and triggers the same
 * event processing pipeline as webhooks.
 *
 * Features:
 * - Configurable polling interval (default: 30s)
 * - Event deduplication via lastEventId tracking
 * - Reuses existing webhook handler logic for event processing
 */

import { v4 as uuidv4 } from "uuid";
import type {
  GitLabWebhookStore,
  GitLabWebhookConfig,
} from "../store/gitlab-webhook-store";
import type { BackgroundTaskStore } from "../store/background-task-store";
import {
  normalizeGitLabEvent as _normalizeGitLabEvent,
  extractGitLabAction,
  eventMatchesConfig,
  buildPrompt,
  type GitLabWebhookPayload,
} from "../webhooks/gitlab-webhook-handler";
import { createBackgroundTask } from "../models/background-task";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitLabPollingConfig {
  enabled: boolean;
  intervalSeconds: number;
  /** Last processed event ID per repo (for deduplication) */
  lastEventIds: Record<string, string>;
  lastCheckedAt?: Date;
}

export interface GitLabEvent {
  id: number;
  project_id: number;
  action: string;
  target_type: string;
  created_at: string;
  note?: {
    id: number;
    type: string;
    noteable_type: string;
    noteable_iid: number;
    author_id: number;
    created_at: string;
  };
  author?: {
    id: number;
    username: string;
    name: string;
  };
}

export interface GitLabPollResult {
  repo: string;
  eventsFound: number;
  eventsProcessed: number;
  eventsSkipped: number;
  newLastEventId?: string;
  error?: string;
}

// ─── Polling Adapter ─────────────────────────────────────────────────────────

export class GitLabPollingAdapter {
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private config: GitLabPollingConfig = {
    enabled: false,
    intervalSeconds: 30,
    lastEventIds: {},
  };

  constructor(
    private webhookStore: GitLabWebhookStore,
    private backgroundTaskStore: BackgroundTaskStore,
    private workspaceId?: string
  ) {
    this.initFromEnv();
  }

  private initFromEnv(): void {
    const enabled = process.env.GITLAB_POLLING_ENABLED === "true";
    const interval = parseInt(process.env.GITLAB_POLLING_INTERVAL ?? "30", 10);

    this.config.enabled = enabled;
    this.config.intervalSeconds = Math.max(10, interval); // Minimum 10 seconds

    if (enabled) {
      console.log(
        `[GitLabPolling] Auto-starting from env: interval=${this.config.intervalSeconds}s`
      );
      this.start();
    }
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  getConfig(): GitLabPollingConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<GitLabPollingConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.intervalSeconds && this.pollingTimer) {
      this.stop();
      this.start();
    }
  }

  isRunning(): boolean {
    return this.pollingTimer !== null;
  }

  // ─── Start/Stop ────────────────────────────────────────────────────────────

  start(): void {
    if (this.pollingTimer || !this.config.enabled) return;
    const intervalMs = this.config.intervalSeconds * 1000;
    this.pollingTimer = setInterval(() => {
      void this.pollAllRepos();
    }, intervalMs);
    console.log(`[GitLabPolling] Started with ${this.config.intervalSeconds}s interval`);
    void this.pollAllRepos();
  }

  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      console.log("[GitLabPolling] Stopped");
    }
  }

  // ─── Manual Check ──────────────────────────────────────────────────────────

  async checkNow(): Promise<GitLabPollResult[]> {
    return this.pollAllRepos();
  }

  // ─── Core Polling Logic ────────────────────────────────────────────────────

  async pollAllRepos(): Promise<GitLabPollResult[]> {
    const configs = await this.webhookStore.listConfigs();
    const enabledConfigs = configs.filter((c) => c.enabled);

    const repos = [...new Set(enabledConfigs.map((c) => c.repo))];
    const results: GitLabPollResult[] = [];

    for (const repo of repos) {
      const repoConfigs = enabledConfigs.filter((c) => c.repo === repo);
      const result = await this.pollRepo(repo, repoConfigs);
      results.push(result);
    }

    this.config.lastCheckedAt = new Date();
    return results;
  }

  async pollRepo(repo: string, configs: GitLabWebhookConfig[]): Promise<GitLabPollResult> {
    const result: GitLabPollResult = { repo, eventsFound: 0, eventsProcessed: 0, eventsSkipped: 0 };

    const token = configs[0]?.gitlabToken;
    if (!token) {
      result.error = "No GitLab token configured";
      return result;
    }

    try {
      const events = await this.fetchProjectEvents(repo, token);
      result.eventsFound = events.length;

      const lastEventId = this.config.lastEventIds[repo];

      // GitLab Events API returns events newest-first.
      const newEvents: GitLabEvent[] = [];
      for (const event of events) {
        if (String(event.id) === lastEventId) break;
        newEvents.push(event);
      }

      if (newEvents.length > 0) {
        result.newLastEventId = String(newEvents[0].id);
        this.config.lastEventIds[repo] = String(newEvents[0].id);
      }

      // Process new events (in chronological order: oldest first)
      for (const event of newEvents.reverse()) {
        const processed = await this.processEvent(event, configs, repo);
        if (processed) {
          result.eventsProcessed++;
        } else {
          result.eventsSkipped++;
        }
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.error(`[GitLabPolling] Error polling ${repo}:`, err);
    }

    return result;
  }

  private async fetchProjectEvents(repo: string, token: string): Promise<GitLabEvent[]> {
    const baseUrl = process.env.GITLAB_URL ?? "https://gitlab.com";
    const encodedPath = repo.replace(/\//g, "%2F");
    const url = `${baseUrl}/api/v4/projects/${encodedPath}/events?per_page=30`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("GitLab API authentication failed. Check your token.");
      }
      if (response.status === 404) {
        throw new Error(`Project not found: ${repo}. Check the name and your access permissions.`);
      }
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async processEvent(
    event: GitLabEvent,
    configs: GitLabWebhookConfig[],
    repo: string
  ): Promise<boolean> {
    // Map GitLab event type to webhook event type
    const eventType = this.mapEventType(event);
    if (!eventType) {
      return false;
    }

    // Convert GitLab event to webhook payload format
    const payload = this.convertToWebhookPayload(event, repo);

    let triggered = false;
    for (const config of configs) {
      if (!eventMatchesConfig(config, eventType, payload)) {
        continue;
      }

      try {
        const prompt = buildPrompt(config, eventType, payload);
        const action = extractGitLabAction(payload);
        const taskTitle = `[GitLab ${eventType}] ${repo} — ${action ?? "event"} (polled)`;
        const workspaceId = config.workspaceId ?? this.workspaceId;
        if (!workspaceId) {
          console.warn(
            `[GitLabPolling] Skipping config ${config.id} because no workspaceId is available`
          );
          continue;
        }

        const task = createBackgroundTask({
          id: uuidv4(),
          prompt,
          agentId: config.triggerAgentId,
          workspaceId,
          title: taskTitle,
          triggerSource: "polling",
          triggeredBy: `gitlab:${eventType}`,
          maxAttempts: 1,
        });

        await this.backgroundTaskStore.save(task);

        // Log the trigger
        await this.webhookStore.appendLog({
          configId: config.id,
          eventType,
          eventAction: extractGitLabAction(payload),
          payload: payload as Record<string, unknown>,
          backgroundTaskId: task.id,
          signatureValid: true,
          outcome: "triggered",
        });

        triggered = true;
        console.log(`[GitLabPolling] Triggered task for ${eventType} on ${repo}`);
      } catch (err) {
        console.error(`[GitLabPolling] Error processing event:`, err);
        await this.webhookStore.appendLog({
          configId: config.id,
          eventType,
          eventAction: extractGitLabAction(payload),
          payload: payload as Record<string, unknown>,
          signatureValid: true,
          outcome: "error",
          errorMessage: String(err),
        });
      }
    }

    return triggered;
  }

  private mapEventType(event: GitLabEvent): string | undefined {
    // Map GitLab event target_type to webhook event types
    const typeMap: Record<string, string> = {
      "Issue": "issues",
      "MergeRequest": "merge_request",
      "Milestone": "milestone",
      "Note": "note",
      "Project": "project",
      "Snippet": "snippet",
      "Commit": "commit",
      "Build": "build",
      "WikiPage": "wiki_page",
      "Deployment": "deployment",
    };

    return typeMap[event.target_type] ?? event.target_type.toLowerCase();
  }

  private convertToWebhookPayload(event: GitLabEvent, repo: string): GitLabWebhookPayload {
    const payload: GitLabWebhookPayload = {
      object_kind: this.mapEventType(event),
      project: {
        id: event.project_id,
        path_with_namespace: repo,
        web_url: `${process.env.GITLAB_URL ?? "https://gitlab.com"}/${repo}`,
        default_branch: "main",
        repository: { visibility: "private" },
      },
      user: event.author ? {
        username: event.author.username,
        name: event.author.name,
      } : undefined,
    };

    // Add event-specific data based on target_type
    if (event.target_type === "Issue" && event.note) {
      payload.issue = {
        id: event.note.id,
        iid: event.note.noteable_iid,
        title: `Issue #${event.note.noteable_iid}`,
        url: `${process.env.GITLAB_URL ?? "https://gitlab.com"}/${repo}/-/issues/${event.note.noteable_iid}`,
        state: "open",
        labels: [],
        author: { username: event.author?.username ?? "unknown" },
      };
    }

    if (event.target_type === "MergeRequest" && event.note) {
      payload.object_attributes = {
        id: event.note.id,
        iid: event.note.noteable_iid,
        title: `Merge Request !${event.note.noteable_iid}`,
        url: `${process.env.GITLAB_URL ?? "https://gitlab.com"}/${repo}/-/merge_requests/${event.note.noteable_iid}`,
        state: "open",
        action: event.action,
        source_branch: "feature",
        target_branch: "main",
        author: { username: event.author?.username ?? "unknown", name: event.author?.name ?? "Unknown" },
        created_at: event.created_at,
        updated_at: event.created_at,
      };
    }

    if (event.target_type === "Note" && event.note) {
      payload.object_kind = "note";
      payload.note = {
        id: event.note.id,
        type: event.note.type ?? null,
        noteable_type: event.note.noteable_type,
        noteable_iid: event.note.noteable_iid,
        project_id: event.project_id,
        created_at: event.created_at,
        updated_at: event.created_at,
        body: "Comment (polling mode - full text not available)",
        author: { username: event.author?.username ?? "unknown", name: event.author?.name ?? "Unknown" },
      };
    }

    return payload;
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

let pollingAdapterInstance: GitLabPollingAdapter | null = null;

export function getGitLabPollingAdapter(
  webhookStore: GitLabWebhookStore,
  backgroundTaskStore: BackgroundTaskStore,
  workspaceId?: string
): GitLabPollingAdapter {
  if (!pollingAdapterInstance) {
    pollingAdapterInstance = new GitLabPollingAdapter(
      webhookStore,
      backgroundTaskStore,
      workspaceId
    );
  }
  return pollingAdapterInstance;
}

export function resetGitLabPollingAdapter(): void {
  if (pollingAdapterInstance) {
    pollingAdapterInstance.stop();
    pollingAdapterInstance = null;
  }
}
