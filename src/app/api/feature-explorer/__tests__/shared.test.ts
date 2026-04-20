/**
 * @vitest-environment node
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FeatureTree } from "../shared";
import { collectFeatureSessionStats, parseFeatureTree } from "../shared";

function createFeatureTree(): FeatureTree {
  return {
    capabilityGroups: [],
    features: [
      {
        id: "feature-a",
        name: "Feature A",
        group: "core",
        summary: "Tracks page changes",
        status: "active",
        pages: ["/"],
        apis: [],
        sourceFiles: ["src/app/page.tsx"],
        relatedFeatures: [],
        domainObjects: [],
      },
    ],
    frontendPages: [],
    apiEndpoints: [],
    nextjsApiEndpoints: [],
    rustApiEndpoints: [],
    implementationApiEndpoints: [],
  };
}

function createDirectoryFallbackFeatureTree(): FeatureTree {
  return {
    capabilityGroups: [],
    features: [
      {
        id: "feature-directory",
        name: "Feature Directory",
        group: "core",
        summary: "Tracks nested workspace feature explorer files",
        status: "active",
        pages: [],
        apis: [],
        sourceFiles: ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"],
        relatedFeatures: [],
        domainObjects: [],
      },
    ],
    frontendPages: [],
    apiEndpoints: [],
    nextjsApiEndpoints: [],
    rustApiEndpoints: [],
    implementationApiEndpoints: [],
  };
}

function ensureFile(filePath: string, content = ""): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeCodexTranscript(
  filePath: string,
  cwd: string,
  output: string,
  modifiedMs: number,
  sessionId = path.basename(filePath, path.extname(filePath)),
): void {
  ensureFile(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-04-17T01:51:41.963Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2026-04-17T01:50:56.919Z",
          cwd,
          source: "cli",
          model_provider: "openai",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T02:31:10.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "git status --short"],
          aggregated_output: output,
          exit_code: 0,
        },
      }),
      "",
    ].join("\n"),
  );

  const modifiedAt = new Date(modifiedMs);
  fs.utimesSync(filePath, modifiedAt, modifiedAt);
}

function runGit(repoRoot: string, args: string[]): void {
  execFileSync("git", ["-C", repoRoot, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("feature explorer transcript stats", () => {
  const originalHome = process.env.HOME;
  const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

  beforeEach(() => {
    process.env.CLAUDE_CONFIG_DIR = "";
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  });

  it("applies the transcript cap after repo matching", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-shared-"));
    process.env.HOME = tempRoot;

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");

    const sessionRoot = path.join(tempRoot, ".codex", "sessions");
    const now = Date.now();

    for (let index = 0; index <= 200; index += 1) {
      writeCodexTranscript(
        path.join(sessionRoot, `unmatched-${index}.jsonl`),
        path.join(tempRoot, `other-repo-${index}`),
        " M src/app/page.tsx\n",
        now - index,
      );
    }

    writeCodexTranscript(
      path.join(sessionRoot, "matched.jsonl"),
      repoRoot,
      " M src/app/page.tsx\n",
      now - 10_000,
      "matched-session",
    );

    const { featureStats, fileStats } = collectFeatureSessionStats(repoRoot, createFeatureTree());

    expect(featureStats["feature-a"]).toMatchObject({
      sessionCount: 1,
      changedFiles: 1,
      matchedFiles: ["src/app/page.tsx"],
    });
    expect(fileStats["src/app/page.tsx"]).toMatchObject({
      changes: 1,
      sessions: 1,
    });
  });

  it("matches git worktree sessions for the same repository", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-worktree-"));
    process.env.HOME = tempRoot;

    const repoRoot = path.join(tempRoot, "repo");
    const worktreeRoot = path.join(tempRoot, "repo-worktree");
    const branchName = `feature/worktree-stats-${path.basename(tempRoot)}`;
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");

    runGit(repoRoot, ["init"]);
    runGit(repoRoot, ["config", "user.name", "Test User"]);
    runGit(repoRoot, ["config", "user.email", "test@example.com"]);
    runGit(repoRoot, ["add", "src/app/page.tsx"]);
    runGit(repoRoot, ["commit", "-m", "init"]);
    runGit(repoRoot, ["worktree", "add", "-b", branchName, worktreeRoot]);

    writeCodexTranscript(
      path.join(tempRoot, ".codex", "sessions", "worktree.jsonl"),
      worktreeRoot,
      " M src/app/page.tsx\n",
      Date.now(),
      "worktree-session",
    );

    const { featureStats, fileStats } = collectFeatureSessionStats(repoRoot, createFeatureTree());

    expect(featureStats["feature-a"]).toMatchObject({
      sessionCount: 1,
      changedFiles: 1,
      matchedFiles: ["src/app/page.tsx"],
    });
    expect(fileStats["src/app/page.tsx"]).toMatchObject({
      changes: 1,
      sessions: 1,
    });
  });
  it("does not attribute unrelated changed files to every feature", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-unrelated-"));
    process.env.HOME = tempRoot;

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");
    ensureFile(path.join(repoRoot, "src/app/other/page.tsx"), "export default function Other() { return null; }\n");

    writeCodexTranscript(
      path.join(tempRoot, ".codex", "sessions", "other.jsonl"),
      repoRoot,
      " M src/app/other/page.tsx\n",
      Date.now(),
      "other-session",
    );

    const { featureStats, fileStats } = collectFeatureSessionStats(repoRoot, createFeatureTree());

    expect(featureStats["feature-a"]).toBeUndefined();
    expect(fileStats["src/app/other/page.tsx"]).toMatchObject({
      changes: 1,
      sessions: 1,
    });
  });

  it("sanitizes noisy path values before attributing files", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-noisy-path-"));
    process.env.HOME = tempRoot;

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");

    ensureFile(
      path.join(tempRoot, ".codex", "sessions", "noisy.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-17T01:51:41.963Z",
          type: "session_meta",
          payload: {
            id: "noisy-session",
            timestamp: "2026-04-17T01:50:56.919Z",
            cwd: repoRoot,
            source: "cli",
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-17T02:31:10.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "write_result",
            path: "src/app/page.tsx (3 tests) 3ms\",",
          },
        }),
        "",
      ].join("\n"),
    );

    const { featureStats, fileStats } = collectFeatureSessionStats(repoRoot, createFeatureTree());

    expect(featureStats["feature-a"]).toMatchObject({
      sessionCount: 1,
      changedFiles: 1,
      matchedFiles: ["src/app/page.tsx"],
    });
    expect(fileStats["src/app/page.tsx"]).toMatchObject({
      changes: 1,
      sessions: 1,
    });
  });

  it("attributed feature changes by directory when route declarations are absent", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-directory-"));
    process.env.HOME = tempRoot;

    const repoRoot = path.join(tempRoot, "repo");
    const featureExplorerRoute = path.join(repoRoot, "src/app/workspace/[workspaceId]/feature-explorer");
    ensureFile(path.join(featureExplorerRoute, "page.tsx"), "export default function Page() { return null; }\n");
    ensureFile(path.join(featureExplorerRoute, "widget.tsx"), "export default function Widget() { return null; }\n");

    writeCodexTranscript(
      path.join(tempRoot, ".codex", "sessions", "directory.jsonl"),
      repoRoot,
      " M src/app/workspace/[workspaceId]/feature-explorer/widget.tsx\n",
      Date.now(),
      "directory-session",
    );

    const { featureStats, fileStats } = collectFeatureSessionStats(
      repoRoot,
      createDirectoryFallbackFeatureTree(),
    );

    expect(featureStats["feature-directory"]).toMatchObject({
      sessionCount: 1,
      changedFiles: 1,
      matchedFiles: ["src/app/workspace/[workspaceId]/feature-explorer/widget.tsx"],
    });
    expect(fileStats["src/app/workspace/[workspaceId]/feature-explorer/widget.tsx"]).toMatchObject({
      changes: 1,
      sessions: 1,
    });
  });

  it("ignores directory paths and strips line-qualified markdown references", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-sanitize-"));
    process.env.HOME = tempRoot;

    const repoRoot = path.join(tempRoot, "repo");
    const featureRoot = path.join(repoRoot, "src/app/workspace/[workspaceId]/feature-explorer");
    ensureFile(path.join(featureRoot, "page.tsx"), "export default function Page() { return null; }\n");
    ensureFile(path.join(featureRoot, "README.md"), "# Feature Explorer\n");

    ensureFile(
      path.join(tempRoot, ".codex", "sessions", "sanitize.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-17T01:51:41.963Z",
          type: "session_meta",
          payload: {
            id: "sanitize-session",
            timestamp: "2026-04-17T01:50:56.919Z",
            cwd: repoRoot,
            source: "cli",
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-17T02:31:10.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "grep_context",
            file: "src/app/workspace/[workspaceId]/feature-explorer/README.md:5",
            path: "src/app/workspace/[workspaceId]/feature-explorer/",
          },
        }),
        "",
      ].join("\n"),
    );

    const { fileStats } = collectFeatureSessionStats(repoRoot, createDirectoryFallbackFeatureTree());

    expect(fileStats["src/app/workspace/[workspaceId]/feature-explorer/README.md"]).toMatchObject({
      changes: 1,
      sessions: 1,
    });
    expect(fileStats["src/app/workspace/[workspaceId]/feature-explorer/"]).toBeUndefined();
  });

  it("collects file session evidence with provider, session id, and prompt history", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-signals-"));
    process.env.HOME = tempRoot;

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");

    ensureFile(
      path.join(tempRoot, ".codex", "sessions", "signals.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-17T01:51:41.963Z",
          type: "session_meta",
          payload: {
            id: "019d-signal-session",
            timestamp: "2026-04-17T01:50:56.919Z",
            cwd: repoRoot,
            source: "cli",
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-17T01:55:10.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Please wire feature explorer file signals into the right panel",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-17T01:56:10.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,200p' src/app/page.tsx\"}",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-17T01:56:40.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "apply_patch",
            arguments: "*** Begin Patch\n*** Update File: src/app/page.tsx\n@@\n-const oldView = null;\n+const nextView = <main />;\n*** End Patch\n",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-17T01:57:10.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/app/page.tsx\n",
          },
        }),
        "",
      ].join("\n"),
    );

    const { fileSignals } = collectFeatureSessionStats(repoRoot, createFeatureTree());
    const signal = fileSignals["src/app/page.tsx"];

    expect(signal).toBeDefined();
    expect(signal?.sessions[0]).toMatchObject({
      provider: "codex",
      sessionId: "019d-signal-session",
      resumeCommand: "codex resume 019d-signal-session",
      changedFiles: ["src/app/page.tsx"],
    });
    expect(signal?.sessions[0]?.diagnostics).toMatchObject({
      toolCallCount: 3,
      failedToolCallCount: 0,
      readFiles: ["src/app/page.tsx"],
      writtenFiles: ["src/app/page.tsx"],
    });
    expect(signal?.sessions[0]?.diagnostics?.toolCallsByName).toMatchObject({
      apply_patch: 1,
      exec_command: 2,
    });
    expect(signal?.sessions[0]?.promptHistory[0]).toContain("feature explorer file signals");
    expect(signal?.sessions[0]?.toolNames).toContain("apply_patch");
    expect(signal?.toolHistory).toContain("exec_command");
    expect(signal?.promptHistory[0]).toContain("feature explorer file signals");
  });

  it("derives feature source files from the generated surface index", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-tree-"));
    const repoRoot = path.join(tempRoot, "repo");

    ensureFile(
      path.join(repoRoot, "docs/product-specs/FEATURE_TREE.md"),
      `---
feature_metadata:
  capability_groups:
    - id: workspace-coordination
      name: Workspace Coordination
  features:
    - id: feature-explorer
      name: Feature Explorer
      group: workspace-coordination
      pages:
        - /workspace/:workspaceId/feature-explorer
      apis:
        - GET /api/feature-explorer
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Workspace / Feature Explorer | \`/workspace/:workspaceId/feature-explorer\` | \`src/app/workspace/[workspaceId]/feature-explorer/page.tsx\` |  |

## API Contract Endpoints

### Feature-Explorer (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | \`/api/feature-explorer\` | List feature explorer features | \`src/app/api/feature-explorer/route.ts\` | \`crates/routa-server/src/api/feature_explorer.rs\` |
`,
    );

    const featureTree = parseFeatureTree(repoRoot);
    expect(featureTree.frontendPages[0]).toMatchObject({
      route: "/workspace/:workspaceId/feature-explorer",
      sourceFile: "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
    });
    expect(featureTree.features[0]?.sourceFiles).toEqual([
      "crates/routa-server/src/api/feature_explorer.rs",
      "src/app/api/feature-explorer/route.ts",
      "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
    ]);
  });

  it("returns an empty feature tree when generated artifacts are missing", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-empty-"));
    const repoRoot = path.join(tempRoot, "repo");

    const featureTree = parseFeatureTree(repoRoot);

    expect(featureTree).toEqual({
      capabilityGroups: [],
      features: [],
      frontendPages: [],
      apiEndpoints: [],
      nextjsApiEndpoints: [],
      rustApiEndpoints: [],
      implementationApiEndpoints: [],
    });
  });

  it("infers features from legacy generated markdown without feature metadata frontmatter", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-legacy-"));
    const repoRoot = path.join(tempRoot, "repo");

    ensureFile(
      path.join(repoRoot, "docs/product-specs/FEATURE_TREE.md"),
      `---
status: generated
purpose: Auto-generated route and API surface index for Routa.js.
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Description |
|------|-------|-------------|
| Feature Explorer | \`/workspace/:workspaceId/feature-explorer\` | Browse features |

## API Endpoints

### Feature-Explorer (1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/api/feature-explorer\` | List features |
`,
    );

    const featureTree = parseFeatureTree(repoRoot);

    expect(featureTree.capabilityGroups).toEqual([
      {
        id: "inferred-surfaces",
        name: "Inferred Surfaces",
        description: "Auto-inferred surface clusters derived from generated page and API tables.",
      },
    ]);
    expect(featureTree.features).toEqual([
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        group: "inferred-surfaces",
        summary: "Auto-inferred from FEATURE_TREE surfaces (1 page, 1 API).",
        status: "inferred",
        pages: ["/workspace/:workspaceId/feature-explorer"],
        apis: ["GET /api/feature-explorer"],
        sourceFiles: [],
        relatedFeatures: [],
        domainObjects: [],
      },
    ]);
    expect(featureTree.frontendPages).toEqual([
      {
        name: "Feature Explorer",
        route: "/workspace/:workspaceId/feature-explorer",
        sourceFile: "",
        description: "Browse features",
      },
    ]);
    expect(featureTree.apiEndpoints).toEqual([
      {
        group: "feature-explorer",
        method: "GET",
        endpoint: "/api/feature-explorer",
        description: "List features",
      },
    ]);
  });

  it("infers feature ownership for unmapped surfaces from the generated tables", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-inferred-"));
    const repoRoot = path.join(tempRoot, "repo");

    ensureFile(
      path.join(repoRoot, "docs/product-specs/FEATURE_TREE.md"),
      `---
feature_metadata:
  capability_groups:
    - id: workspace-coordination
      name: Workspace Coordination
  features:
    - id: workspace-overview
      name: Workspace Overview
      group: workspace-coordination
      pages:
        - /workspace/:workspaceId/overview
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Workspace / Overview | \`/workspace/:workspaceId/overview\` | \`src/app/workspace/[workspaceId]/overview/page.tsx\` |  |
| Settings / Agents | \`/settings/agents\` | \`src/app/settings/agents/page.tsx\` |  |

## API Contract Endpoints

### Agents (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | \`/api/agents\` | List agents | \`src/app/api/agents/route.ts\` | \`crates/routa-server/src/api/agents.rs\` |
`,
    );

    const featureTree = parseFeatureTree(repoRoot);
    expect(featureTree.features.find((feature) => feature.id === "agents")).toMatchObject({
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

  it("parses generic implementation API sections from generated markdown", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feature-explorer-spring-"));
    const repoRoot = path.join(tempRoot, "repo");

    ensureFile(
      path.join(repoRoot, "docs/product-specs/FEATURE_TREE.md"),
      `---
feature_metadata:
  capability_groups:
    - id: administration
      name: Administration
  features:
    - id: admin-dashboard
      name: Admin Dashboard
      group: administration
      pages:
        - /admin/dashboard
      apis:
        - GET /admin/dashboard
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Admin Dashboard | \`/admin/dashboard\` | \`src/main/resources/templates/dashboard.html\` |  |

## API Contract Endpoints

### Admin (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | \`/admin/dashboard\` | Render Dashboard |

## Spring MVC API Routes

### Admin (1)

| Method | Endpoint | Source Files |
|--------|----------|--------------|
| GET | \`/admin/dashboard\` | \`src/main/java/com/example/controller/AdminController.java\` |
`,
    );

    const featureTree = parseFeatureTree(repoRoot);
    expect(featureTree.implementationApiEndpoints).toEqual([
      {
        label: "springMvc",
        group: "admin",
        method: "GET",
        endpoint: "/admin/dashboard",
        sourceFiles: ["src/main/java/com/example/controller/AdminController.java"],
      },
    ]);
    expect(featureTree.features[0]?.sourceFiles).toEqual([
      "src/main/java/com/example/controller/AdminController.java",
      "src/main/resources/templates/dashboard.html",
    ]);
  });
});
