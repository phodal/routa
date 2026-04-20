import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  generateFeatureTree,
  preflightFeatureTree,
} from "../feature-tree-generator";

function mkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath: string, content = ""): void {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

const tempDirs: string[] = [];

function createTempRepo(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (!tempDir) continue;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("feature-tree-generator", () => {
  it("scans Next Pages Router pages while excluding API and framework shell files", async () => {
    const repoRoot = createTempRepo("feature-tree-pages-router-");
    writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ name: "pages-router-repo" }));
    writeFile(path.join(repoRoot, "pages", "index.tsx"), "export default function Home() { return null; }\n");
    writeFile(path.join(repoRoot, "pages", "blog", "[slug].tsx"), "export default function BlogPost() { return null; }\n");
    writeFile(path.join(repoRoot, "pages", "_app.tsx"), "export default function AppShell() { return null; }\n");
    writeFile(path.join(repoRoot, "pages", "_document.tsx"), "export default function Document() { return null; }\n");
    writeFile(path.join(repoRoot, "pages", "_error.tsx"), "export default function ErrorPage() { return null; }\n");
    writeFile(
      path.join(repoRoot, "pages", "api", "health.ts"),
      "export default function handler() { return { ok: true }; }\n",
    );

    const result = await generateFeatureTree({
      repoRoot,
      dryRun: false,
    });

    const surfaceIndex = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "docs", "product-specs", "feature-tree.index.json"), "utf8"),
    ) as {
      pages: Array<{ route: string }>;
      nextjsApis: Array<{ path: string }>;
    };

    expect(result.frameworksDetected).toContain("nextjs");
    expect(result.pagesCount).toBe(2);
    expect(result.apisCount).toBe(1);
    expect(surfaceIndex.pages.map((page) => page.route)).toEqual([
      "/",
      "/blog/:slug",
    ]);
    expect(surfaceIndex.nextjsApis.map((api) => api.path)).toEqual([
      "/api/health",
    ]);
  });

  it("selects a nested Pages Router app root during preflight", () => {
    const repoRoot = createTempRepo("feature-tree-preflight-");
    const nestedAppRoot = path.join(repoRoot, "apps", "storefront");
    writeFile(path.join(nestedAppRoot, "src", "pages", "index.tsx"), "export default function Home() { return null; }\n");
    writeFile(path.join(nestedAppRoot, "src", "pages", "settings.tsx"), "export default function Settings() { return null; }\n");

    const result = preflightFeatureTree(repoRoot);
    const nestedCandidate = result.candidateRoots.find((candidate) => candidate.path === nestedAppRoot);

    expect(result.selectedScanRoot).toBe(nestedAppRoot);
    expect(result.frameworksDetected).toContain("nextjs");
    expect(nestedCandidate).toMatchObject({
      kind: "app",
      surfaceCounts: {
        pages: 2,
        appRouterApis: 0,
        pagesApis: 0,
        rustApis: 0,
      },
    });
  });
});
