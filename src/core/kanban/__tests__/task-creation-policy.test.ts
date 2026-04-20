import { describe, expect, it } from "vitest";
import {
  normalizeTaskCreationSource,
  shouldCreateGitHubIssueOnTaskCreate,
} from "../task-creation-policy";

describe("task creation policy", () => {
  it("defaults unknown sources to api", () => {
    expect(normalizeTaskCreationSource(undefined)).toBe("api");
    expect(normalizeTaskCreationSource("weird")).toBe("api");
  });

  it("preserves supported creation sources", () => {
    expect(normalizeTaskCreationSource("manual")).toBe("manual");
    expect(normalizeTaskCreationSource("agent")).toBe("agent");
    expect(normalizeTaskCreationSource("session")).toBe("session");
  });

  it("infers session for legacy rows when sessionId exists", () => {
    expect(normalizeTaskCreationSource(undefined, { sessionId: "session-1" })).toBe("session");
  });

  it("only allows GitHub issue creation for manual task creation", () => {
    expect(
      shouldCreateGitHubIssueOnTaskCreate({
        createGitHubIssue: true,
        creationSource: "manual",
      }),
    ).toBe(true);

    expect(
      shouldCreateGitHubIssueOnTaskCreate({
        createGitHubIssue: true,
        creationSource: "agent",
      }),
    ).toBe(false);

    expect(
      shouldCreateGitHubIssueOnTaskCreate({
        createGitHubIssue: true,
        creationSource: "api",
      }),
    ).toBe(false);
  });
});
