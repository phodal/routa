/**
 * Tests for GitHub Webhook Handler - Phase 2 Events
 * 
 * Verifies support for:
 * - CI/CD events: check_suite, workflow_run, workflow_job
 * - PR review events: pull_request_review, pull_request_review_comment
 * - Tag/Branch events: create, delete
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleGitHubWebhook,
  buildPrompt,
  eventMatchesConfig,
  type GitHubWebhookPayload,
} from "../github-webhook-handler";
import type { GitHubWebhookConfig } from "../../store/github-webhook-store";
import { InMemoryGitHubWebhookStore } from "../../store/github-webhook-store";
import { InMemoryBackgroundTaskStore } from "../../store/background-task-store";

const WORKSPACE_ID = "workspace-1";

describe("GitHub Webhook Handler - Phase 2 Events", () => {
  let webhookStore: InMemoryGitHubWebhookStore;
  let backgroundTaskStore: InMemoryBackgroundTaskStore;
  const originalFetch = global.fetch;

  beforeEach(() => {
    webhookStore = new InMemoryGitHubWebhookStore();
    backgroundTaskStore = new InMemoryBackgroundTaskStore();
    global.fetch = (async () => ({
      ok: false,
      status: 404,
      text: async () => "not found",
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("check_suite event", () => {
    it("should handle check_suite.completed event", async () => {
      const config = await webhookStore.createConfig({
        name: "CI Check Suite Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["check_suite"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        action: "completed",
        check_suite: {
          id: 12345,
          status: "completed",
          conclusion: "failure",
          head_branch: "main",
          head_sha: "abc123def456",
          url: "https://api.github.com/repos/owner/repo/check-suites/12345",
          pull_requests: [{ number: 42, url: "https://api.github.com/repos/owner/repo/pulls/42" }],
        },
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
      };

      const result = await handleGitHubWebhook({
        eventType: "check_suite",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(0);

      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].prompt).toContain("Check Suite #12345");
      expect(tasks[0].prompt).toContain("Status: completed, Conclusion: failure");
      expect(tasks[0].prompt).toContain("Branch: main");
      expect(tasks[0].prompt).toContain("PRs: #42");
    });

    it("should build context for check_suite event", () => {
      const config: GitHubWebhookConfig = {
        id: "test",
        name: "Test",
        repo: "owner/repo",
        githubToken: "token",
        webhookSecret: "",
        eventTypes: ["check_suite"],
        labelFilter: [],
        triggerAgentId: "claude-code",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const payload: GitHubWebhookPayload = {
        action: "completed",
        check_suite: {
          id: 999,
          status: "completed",
          conclusion: "success",
          head_branch: "feature-branch",
          head_sha: "abc1234",
          url: "https://api.github.com/check-suites/999",
        },
      };

      const prompt = buildPrompt(config, "check_suite", payload);
      expect(prompt).toContain("check_suite");
      expect(prompt).toContain("Check Suite #999");
      expect(prompt).toContain("success");
    });
  });

  describe("workflow_run event", () => {
    it("should handle workflow_run.completed event", async () => {
      const config = await webhookStore.createConfig({
        name: "Workflow Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["workflow_run"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        action: "completed",
        workflow_run: {
          id: 789,
          name: "CI Pipeline",
          status: "completed",
          conclusion: "failure",
          workflow_id: 123,
          html_url: "https://github.com/owner/repo/actions/runs/789",
          head_branch: "main",
          head_sha: "def456abc",
          event: "push",
          run_number: 42,
          run_attempt: 1,
        },
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
      };

      const result = await handleGitHubWebhook({
        eventType: "workflow_run",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("Workflow: CI Pipeline (#42)");
      expect(tasks[0].prompt).toContain("Status: completed, Conclusion: failure");
      expect(tasks[0].prompt).toContain("Triggered by: push");
      expect(tasks[0].prompt).toContain("Attempt: 1");
    });
  });

  describe("workflow_job event", () => {
    it("should handle workflow_job.completed event with failed steps", async () => {
      const config = await webhookStore.createConfig({
        name: "Job Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["workflow_job"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        action: "completed",
        workflow_job: {
          id: 456,
          name: "build",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/owner/repo/actions/runs/789/jobs/456",
          workflow_name: "CI Pipeline",
          runner_name: "ubuntu-latest",
          steps: [
            { name: "Checkout", status: "completed", conclusion: "success" },
            { name: "Build", status: "completed", conclusion: "failure" },
            { name: "Test", status: "completed", conclusion: "skipped" },
          ],
        },
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
      };

      const result = await handleGitHubWebhook({
        eventType: "workflow_job",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("Job: build (CI Pipeline)");
      expect(tasks[0].prompt).toContain("Status: completed, Conclusion: failure");
      expect(tasks[0].prompt).toContain("Failed steps: Build");
    });
  });

  describe("pull_request_review event", () => {
    it("should handle pull_request_review.submitted event", async () => {
      const config = await webhookStore.createConfig({
        name: "PR Review Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["pull_request_review"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        action: "submitted",
        pull_request: {
          number: 42,
          title: "Add new feature",
          body: "This PR adds a new feature",
          html_url: "https://github.com/owner/repo/pull/42",
          state: "open",
          head: { ref: "feature-branch", sha: "abc123" },
          base: { ref: "main" },
        },
        review: {
          id: 999,
          state: "changes_requested",
          body: "Please fix the tests",
          html_url: "https://github.com/owner/repo/pull/42#pullrequestreview-999",
          user: { login: "reviewer" },
        },
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
      };

      const result = await handleGitHubWebhook({
        eventType: "pull_request_review",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("PR #42: Add new feature");
      expect(tasks[0].prompt).toContain("Review by reviewer: changes_requested");
      expect(tasks[0].prompt).toContain("Please fix the tests");
    });
  });

  describe("pull_request_review_comment event", () => {
    it("should handle pull_request_review_comment.created event", async () => {
      const config = await webhookStore.createConfig({
        name: "PR Comment Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["pull_request_review_comment"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        action: "created",
        pull_request: {
          number: 42,
          title: "Add new feature",
          html_url: "https://github.com/owner/repo/pull/42",
          state: "open",
          head: { ref: "feature-branch", sha: "abc123" },
          base: { ref: "main" },
        },
        comment: {
          id: 888,
          body: "This line needs refactoring",
          html_url: "https://github.com/owner/repo/pull/42#discussion_r888",
          user: { login: "reviewer" },
          path: "src/app.ts",
          line: 42,
        },
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
      };

      const result = await handleGitHubWebhook({
        eventType: "pull_request_review_comment",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("PR #42: Add new feature");
      expect(tasks[0].prompt).toContain("Comment by reviewer");
      expect(tasks[0].prompt).toContain("File: src/app.ts:42");
      expect(tasks[0].prompt).toContain("This line needs refactoring");
    });

    it("adds ownership routing context when CODEOWNERS can be resolved", async () => {
      await webhookStore.createConfig({
        name: "PR Comment Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["pull_request_review_comment"],
        triggerAgentId: "claude-code",
      });

      global.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/contents/.github/CODEOWNERS")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              content: Buffer.from("src/** @frontend-team\n").toString("base64"),
              encoding: "base64",
            }),
          } as Response;
        }
        if (url.includes("/contents/docs/fitness/review-triggers.yaml")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              content: Buffer.from(
                "review_triggers:\n  - name: ui_change\n    type: changed_paths\n    severity: medium\n    action: require_human_review\n    paths:\n      - src/**\n",
              ).toString("base64"),
              encoding: "base64",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
          text: async () => "not found",
        } as Response;
      }) as typeof fetch;

      const payload: GitHubWebhookPayload = {
        action: "created",
        pull_request: {
          number: 42,
          title: "Add new feature",
          html_url: "https://github.com/owner/repo/pull/42",
          state: "open",
          head: { ref: "feature-branch", sha: "abc123" },
          base: { ref: "main" },
        },
        comment: {
          id: 888,
          body: "This line needs refactoring",
          html_url: "https://github.com/owner/repo/pull/42#discussion_r888",
          user: { login: "reviewer" },
          path: "src/app.ts",
          line: 42,
        },
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
      };

      await handleGitHubWebhook({
        eventType: "pull_request_review_comment",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("Ownership routing context:");
      expect(tasks[0].prompt).toContain("Touched owners: @frontend-team");
      expect(tasks[0].prompt).toContain("Cross-owner triggers: none");
    });
  });

  describe("create event (tags and branches)", () => {
    it("should handle create event for tags", async () => {
      const config = await webhookStore.createConfig({
        name: "Tag Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["create"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        ref: "v1.0.0",
        ref_type: "tag",
        master_branch: "main",
        pusher_type: "user",
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
        sender: { login: "developer" },
      };

      const result = await handleGitHubWebhook({
        eventType: "create",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("Created tag: v1.0.0");
      expect(tasks[0].prompt).toContain("Default branch: main");
      expect(tasks[0].prompt).toContain("By: developer");
    });

    it("should handle create event for branches", async () => {
      const config = await webhookStore.createConfig({
        name: "Branch Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["create"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        ref: "feature-branch",
        ref_type: "branch",
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
        sender: { login: "developer" },
      };

      const result = await handleGitHubWebhook({
        eventType: "create",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("Created branch: feature-branch");
    });
  });

  describe("delete event (tags and branches)", () => {
    it("should handle delete event for tags", async () => {
      const config = await webhookStore.createConfig({
        name: "Tag Delete Monitor",
        repo: "owner/repo",
        githubToken: "ghp_test",
        webhookSecret: "",
        eventTypes: ["delete"],
        triggerAgentId: "claude-code",
      });

      const payload: GitHubWebhookPayload = {
        ref: "v0.9.0",
        ref_type: "tag",
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
        },
        sender: { login: "developer" },
      };

      const result = await handleGitHubWebhook({
        eventType: "delete",
        rawBody: JSON.stringify(payload),
        payload,
        webhookStore,
        backgroundTaskStore,
        workspaceId: WORKSPACE_ID,
      });

      expect(result.processed).toBe(1);
      const tasks = await backgroundTaskStore.listByWorkspace(WORKSPACE_ID);
      expect(tasks[0].prompt).toContain("Deleted tag: v0.9.0");
      expect(tasks[0].prompt).toContain("By: developer");
    });
  });

  describe("event matching", () => {
    it("should match wildcard event type", () => {
      const config: GitHubWebhookConfig = {
        id: "test",
        name: "Test",
        repo: "owner/repo",
        githubToken: "token",
        webhookSecret: "",
        eventTypes: ["*"],
        labelFilter: [],
        triggerAgentId: "claude-code",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(eventMatchesConfig(config, "check_suite", {})).toBe(true);
      expect(eventMatchesConfig(config, "workflow_run", {})).toBe(true);
      expect(eventMatchesConfig(config, "create", {})).toBe(true);
      expect(eventMatchesConfig(config, "delete", {})).toBe(true);
    });

    it("should match specific Phase 2 event types", () => {
      const config: GitHubWebhookConfig = {
        id: "test",
        name: "Test",
        repo: "owner/repo",
        githubToken: "token",
        webhookSecret: "",
        eventTypes: ["check_suite", "workflow_run", "workflow_job", "create", "delete"],
        labelFilter: [],
        triggerAgentId: "claude-code",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(eventMatchesConfig(config, "check_suite", {})).toBe(true);
      expect(eventMatchesConfig(config, "workflow_run", {})).toBe(true);
      expect(eventMatchesConfig(config, "workflow_job", {})).toBe(true);
      expect(eventMatchesConfig(config, "create", {})).toBe(true);
      expect(eventMatchesConfig(config, "delete", {})).toBe(true);
      expect(eventMatchesConfig(config, "issues", {})).toBe(false);
    });
  });
});
