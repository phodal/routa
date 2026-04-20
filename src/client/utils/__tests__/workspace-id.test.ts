import { describe, expect, it } from "vitest";

import { normalizeWorkspaceQueryId, resolveWorkspaceSelection } from "../workspace-id";
import type { WorkspaceData } from "@/client/hooks/use-workspaces";

const workspaces: WorkspaceData[] = [
  {
    id: "default",
    title: "Default",
    status: "active",
    metadata: {},
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "team_alpha",
    title: "Team Alpha",
    status: "active",
    metadata: {},
    createdAt: "",
    updatedAt: "",
  },
];

describe("workspace-id utilities", () => {
  it("accepts only path-safe workspace ids from query params", () => {
    expect(normalizeWorkspaceQueryId("default")).toBe("default");
    expect(normalizeWorkspaceQueryId(" team_alpha ")).toBe("team_alpha");
    expect(normalizeWorkspaceQueryId("../bad")).toBeNull();
    expect(normalizeWorkspaceQueryId("bad/value")).toBeNull();
    expect(normalizeWorkspaceQueryId("")).toBeNull();
    expect(normalizeWorkspaceQueryId(null)).toBeNull();
  });

  it("prefers an explicit selection over the URL workspace", () => {
    expect(resolveWorkspaceSelection("team_alpha", "default", workspaces)).toBe("team_alpha");
  });

  it("uses the URL workspace only when it exists in the loaded workspace list", () => {
    expect(resolveWorkspaceSelection("", "team_alpha", workspaces)).toBe("team_alpha");
    expect(resolveWorkspaceSelection("", "missing", workspaces)).toBe("default");
  });
});
