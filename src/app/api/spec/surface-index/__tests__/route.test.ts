import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const system = {
  codebaseStore: {
    get: vi.fn(),
    listByWorkspace: vi.fn(),
  },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

async function createTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "routa-spec-surface-index-"));
  await mkdir(path.join(repoRoot, "docs", "product-specs"), { recursive: true });
  return repoRoot;
}

describe("/api/spec/surface-index route", () => {
  it("reads the generated feature tree markdown surface index", async () => {
    const repoRoot = await createTempRepo();

    try {
      await writeFile(
        path.join(repoRoot, "docs", "product-specs", "FEATURE_TREE.md"),
        `---
feature_metadata:
  schema_version: 1
  capability_groups:
    - id: governance-settings
      name: Governance and Settings
  features:
    - id: harness-console
      name: Harness Console
      group: governance-settings
      pages:
        - /workspace/:workspaceId/spec
      apis:
        - GET /api/spec/issues
---

# Product Feature Specification

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Workspace / Spec | \`/workspace/:workspaceId/spec\` | \`src/app/workspace/[workspaceId]/spec/page.tsx\` | Dense issue relationship board |

## API Contract Endpoints

### Spec (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | \`/api/spec/issues\` | List local issue specs | \`src/app/api/spec/issues/route.ts\` | \`crates/routa-server/src/api/spec.rs\` |
`,
      );

      const response = await GET(new NextRequest(
        `http://localhost/api/spec/surface-index?repoPath=${encodeURIComponent(repoRoot)}`,
      ));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.repoRoot).toBe(repoRoot);
      expect(payload.warnings).toEqual([]);
      expect(payload.pages).toHaveLength(1);
      expect(payload.contractApis).toHaveLength(1);
      expect(payload.nextjsApis).toHaveLength(1);
      expect(payload.rustApis).toHaveLength(1);
      expect(payload.implementationApis).toHaveLength(2);
      expect(payload.pages[0]).toMatchObject({
        route: "/workspace/:workspaceId/spec",
        title: "Workspace / Spec",
      });
      expect(payload.contractApis[0]).toMatchObject({
        domain: "spec",
        path: "/api/spec/issues",
      });
      expect(payload.implementationApis).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "nextjs",
            path: "/api/spec/issues",
          }),
          expect.objectContaining({
            label: "rust",
            path: "/api/spec/issues",
          }),
        ]),
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns an empty index with warnings when the generated file is missing", async () => {
    const repoRoot = await createTempRepo();

    try {
      const response = await GET(new NextRequest(
        `http://localhost/api/spec/surface-index?repoPath=${encodeURIComponent(repoRoot)}`,
      ));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.pages).toEqual([]);
      expect(payload.apis).toEqual([]);
      expect(payload.warnings[0]).toContain("FEATURE_TREE.md");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("infers metadata for legacy generated markdown without feature frontmatter", async () => {
    const repoRoot = await createTempRepo();

    try {
      await writeFile(
        path.join(repoRoot, "docs", "product-specs", "FEATURE_TREE.md"),
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

      const response = await GET(new NextRequest(
        `http://localhost/api/spec/surface-index?repoPath=${encodeURIComponent(repoRoot)}`,
      ));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.pages).toHaveLength(1);
      expect(payload.contractApis).toHaveLength(1);
      expect(payload.metadata).toMatchObject({
        capabilityGroups: [
          {
            id: "inferred-surfaces",
            name: "Inferred Surfaces",
          },
        ],
        features: [
          {
            id: "feature-explorer",
            name: "Feature Explorer",
            group: "inferred-surfaces",
            status: "inferred",
            pages: ["/workspace/:workspaceId/feature-explorer"],
            apis: ["GET /api/feature-explorer"],
          },
        ],
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
