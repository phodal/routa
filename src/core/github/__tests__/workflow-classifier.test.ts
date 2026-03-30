import { describe, expect, it } from "vitest";
import {
  classifyGitHubWorkflowCategory,
  normalizeGitHubWorkflowEventTokens,
} from "@/core/github/workflow-classifier";

describe("workflow-classifier", () => {
  it("normalizes comma-separated workflow events", () => {
    expect(normalizeGitHubWorkflowEventTokens("pull_request, workflow_dispatch, push")).toEqual([
      "pull_request",
      "workflow_dispatch",
      "push",
    ]);
  });

  it("classifies release workflows from workflow names and paths", () => {
    expect(classifyGitHubWorkflowCategory({
      name: "Publish CLI",
      event: "workflow_dispatch",
    })).toBe("Release");

    expect(classifyGitHubWorkflowCategory({
      name: "Desktop build",
      event: "workflow_dispatch",
      relativePath: ".github/workflows/tauri-release.yml",
    })).toBe("Release");
  });

  it("classifies maintenance workflows from schedule triggers and cleanup names", () => {
    expect(classifyGitHubWorkflowCategory({
      name: "Nightly hygiene",
      event: "schedule",
    })).toBe("Maintenance");

    expect(classifyGitHubWorkflowCategory({
      name: "Delete merged branches",
      event: "workflow_dispatch",
    })).toBe("Maintenance");
  });

  it("classifies automation workflows from issue-driven triggers", () => {
    expect(classifyGitHubWorkflowCategory({
      name: "Issue handler",
      event: "issues, issue_comment",
    })).toBe("Automation");
  });

  it("classifies validation workflows from CI triggers", () => {
    expect(classifyGitHubWorkflowCategory({
      name: "Defense",
      event: "pull_request, push, workflow_call",
    })).toBe("Validation");
  });
});
