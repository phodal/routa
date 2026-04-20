import { describe, expect, it } from "vitest";

import {
  buildFeatureSurfaceIndex,
  buildFeatureTree,
  normalizeFeatureMetadata,
  parsePageComment,
  readFeatureMetadataFromFeatureTree,
  renderMarkdown,
} from "../docs/feature-tree-generator";

describe("feature-tree-generator", () => {
  it("extracts title and condensed description from page comments", () => {
    const parsed = parsePageComment(`/**
 * Workspace / Kanban - /workspace/default/kanban
 * Shows the board.
 * Supports drag and drop.
 */`);

    expect(parsed.title).toBe("Workspace / Kanban");
    expect(parsed.description).toBe("Shows the board. Supports drag and drop.");
  });

  it("renders markdown with the productized regeneration guidance", () => {
    const tree = buildFeatureTree(
      [{ route: "/", title: "Home", description: "", sourceFile: "src/app/page.tsx" }],
      { agents: [{ domain: "agents", path: "/api/agents", method: "GET", operationId: "listAgents", summary: "List agents" }] },
    );
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 1,
      capabilityGroups: [{ id: "agent-execution", name: "Agent Execution" }],
      features: [{ id: "session-recovery", name: "Session Recovery", group: "agent-execution", pages: ["/"] }],
    });
    const surfaceIndex = buildFeatureSurfaceIndex(
      [{ route: "/", title: "Home", description: "", sourceFile: "src/app/page.tsx" }],
      { agents: [{ domain: "agents", path: "/api/agents", method: "GET", operationId: "listAgents", summary: "List agents" }] },
      [{ domain: "agents", method: "GET", path: "/api/agents", sourceFiles: ["src/app/api/agents/route.ts"] }],
      [{ domain: "agents", method: "GET", path: "/api/agents", sourceFiles: ["crates/routa-server/src/api/agents.rs"] }],
      metadata,
    );

    const markdown = renderMarkdown(tree, surfaceIndex);
    expect(markdown).toContain("routa feature-tree generate");
    expect(markdown).toContain("| Home | `/` | `src/app/page.tsx` |  |");
    expect(markdown).toContain("| GET | `/api/agents` | List agents | `src/app/api/agents/route.ts` | `crates/routa-server/src/api/agents.rs` |");
    expect(markdown).not.toContain("## Next.js API Routes");
    expect(markdown).not.toContain("## Rust API Routes");
    expect(markdown).toContain("feature_metadata:");
    expect(markdown).toContain("schema_version: 1");
    expect(markdown).toContain("Hand-edit semantic `feature_metadata` fields in this frontmatter block.");
    expect(markdown).toContain("Feature metadata: `feature_metadata` frontmatter in this file (`source_files` regenerated)");
    expect(readFeatureMetadataFromFeatureTree(markdown)?.features[0]).toMatchObject({
      id: "session-recovery",
      sourceFiles: ["src/app/page.tsx"],
    });
  });

  it("builds a machine-readable surface index for runtime consumers", () => {
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 1,
      capabilityGroups: [{ id: "workspace-coordination", name: "Workspace Coordination" }],
      features: [{
        id: "workspace-overview",
        name: "Workspace Overview",
        group: "workspace-coordination",
        pages: ["/workspace/:workspaceId/spec"],
      }],
    });
    const index = buildFeatureSurfaceIndex(
      [{ route: "/workspace/:workspaceId/spec", title: "Workspace / Spec", description: "Issue board", sourceFile: "src/app/workspace/[workspaceId]/spec/page.tsx" }],
      {
        spec: [
          {
            domain: "spec",
            path: "/api/spec/issues",
            method: "GET",
            operationId: "listSpecIssues",
            summary: "List local issue specs",
          },
        ],
      },
      [{ domain: "spec", method: "GET", path: "/api/spec/issues", sourceFiles: ["src/app/api/spec/issues/route.ts"] }],
      [{ domain: "spec", method: "GET", path: "/api/spec/issues", sourceFiles: ["crates/routa-server/src/api/spec.rs"] }],
      metadata,
    );

    expect(index.pages).toEqual([
      {
        route: "/workspace/:workspaceId/spec",
        title: "Workspace / Spec",
        description: "Issue board",
        sourceFile: "src/app/workspace/[workspaceId]/spec/page.tsx",
      },
    ]);
    expect(index.apis[0]).toMatchObject({
      domain: "spec",
      path: "/api/spec/issues",
      method: "GET",
      operationId: "listSpecIssues",
    });
    expect(index.contractApis[0]).toMatchObject({
      path: "/api/spec/issues",
    });
    expect(index.nextjsApis[0]).toMatchObject({
      path: "/api/spec/issues",
      sourceFiles: ["src/app/api/spec/issues/route.ts"],
    });
    expect(index.rustApis[0]).toMatchObject({
      path: "/api/spec/issues",
      sourceFiles: ["crates/routa-server/src/api/spec.rs"],
    });
    expect(index.metadata?.features[0]?.sourceFiles).toEqual([
      "src/app/workspace/[workspaceId]/spec/page.tsx",
    ]);
    expect(index.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("derives feature source files from declared API mappings", () => {
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 1,
      capabilityGroups: [{ id: "team-collaboration", name: "Team Collaboration" }],
      features: [
        {
          id: "team-runs",
          name: "Team Runs",
          group: "team-collaboration",
          apis: ["GET /api/sessions/{id}/context"],
        },
      ],
    });

    const index = buildFeatureSurfaceIndex(
      [],
      {
        sessions: [
          {
            domain: "sessions",
            path: "/api/sessions/{id}/context",
            method: "GET",
            operationId: "getSessionContext",
            summary: "Get session context",
          },
        ],
      },
      [{ domain: "sessions", method: "GET", path: "/api/sessions/{id}/context", sourceFiles: ["src/app/api/sessions/[sessionId]/context/route.ts"] }],
      [{ domain: "sessions", method: "GET", path: "/api/sessions/{id}/context", sourceFiles: ["crates/routa-server/src/api/sessions.rs"] }],
      metadata,
    );

    expect(index.metadata?.features[0]?.sourceFiles).toEqual([
      "crates/routa-server/src/api/sessions.rs",
      "src/app/api/sessions/[sessionId]/context/route.ts",
    ]);
  });

  it("infers additional features from unmapped pages and apis", () => {
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 1,
      capabilityGroups: [{ id: "workspace-coordination", name: "Workspace Coordination" }],
      features: [
        {
          id: "workspace-overview",
          name: "Workspace Overview",
          group: "workspace-coordination",
          pages: ["/workspace/:workspaceId/overview"],
        },
      ],
    });

    const index = buildFeatureSurfaceIndex(
      [
        { route: "/workspace/:workspaceId/overview", title: "Workspace / Overview", description: "", sourceFile: "src/app/workspace/[workspaceId]/overview/page.tsx" },
        { route: "/settings/agents", title: "Settings / Agents", description: "", sourceFile: "src/app/settings/agents/page.tsx" },
      ],
      {
        agents: [
          {
            domain: "agents",
            path: "/api/agents",
            method: "GET",
            operationId: "listAgents",
            summary: "List agents",
          },
        ],
      },
      [{ domain: "agents", method: "GET", path: "/api/agents", sourceFiles: ["src/app/api/agents/route.ts"] }],
      [{ domain: "agents", method: "GET", path: "/api/agents", sourceFiles: ["crates/routa-server/src/api/agents.rs"] }],
      metadata,
    );

    expect(index.metadata?.features.find((feature) => feature.id === "agents")).toMatchObject({
      group: "inferred-surfaces",
      pages: ["/settings/agents"],
      apis: ["GET /api/agents"],
      sourceFiles: [
        "crates/routa-server/src/api/agents.rs",
        "src/app/api/agents/route.ts",
        "src/app/settings/agents/page.tsx",
      ],
    });
  });

  it("normalizes feature metadata into a stable shape", () => {
    const metadata = normalizeFeatureMetadata({
      schemaVersion: 2,
      capabilityGroups: [
        {
          id: "kanban-automation",
          name: "Kanban Automation",
          description: "Task flow",
        },
      ],
      features: [
        {
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "kanban-automation",
          pages: ["/workspace/:workspaceId/kanban", "  "],
          apis: ["GET /api/kanban/boards"],
          domainObjects: ["task", "workflow"],
        },
      ],
    });

    expect(metadata).toEqual({
      schemaVersion: 2,
      capabilityGroups: [
        {
          id: "kanban-automation",
          name: "Kanban Automation",
          description: "Task flow",
        },
      ],
      features: [
        {
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "kanban-automation",
          pages: ["/workspace/:workspaceId/kanban"],
          apis: ["GET /api/kanban/boards"],
          domainObjects: ["task", "workflow"],
        },
      ],
    });
  });

  it("reads feature metadata from FEATURE_TREE frontmatter", () => {
    const metadata = readFeatureMetadataFromFeatureTree(`---
status: generated
feature_metadata:
  schema_version: 1
  capability_groups:
    - id: agent-execution
      name: Agent Execution
  features:
    - id: session-recovery
      name: Session Recovery
      group: agent-execution
      domain_objects:
        - session
---

# Title
`);

    expect(metadata).toEqual({
      schemaVersion: 1,
      capabilityGroups: [{ id: "agent-execution", name: "Agent Execution" }],
      features: [
        {
          id: "session-recovery",
          name: "Session Recovery",
          group: "agent-execution",
          domainObjects: ["session"],
        },
      ],
    });
  });
});
