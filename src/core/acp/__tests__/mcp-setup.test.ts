/**
 * @vitest-environment node
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/store/custom-mcp-server-store", () => ({
  getCustomMcpServerStore: () => null,
  mergeCustomMcpServers: (builtIn: Record<string, unknown>) => builtIn,
}));

describe("ensureMcpForProvider", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), "mcp-setup-inline-home-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    vi.resetModules();
    await fsp.rm(tmpHome, { recursive: true, force: true });
  });

  it("writes Claude MCP config to a temp file so SDK parsing still works", async () => {
    const { ensureMcpForProvider, parseMcpServersFromConfigs } = await import("../mcp-setup");

    const result = await ensureMcpForProvider("claude", {
      routaServerUrl: "http://127.0.0.1:3000",
      workspaceId: "ws-test",
      includeCustomServers: false,
    });

    expect(result.mcpConfigs).toHaveLength(1);
    // After fix: config is a file path (contains "mcp-tmp"), not inline JSON
    expect(result.mcpConfigs[0]).toContain("mcp-tmp");

    const parsed = parseMcpServersFromConfigs(result.mcpConfigs);
    expect(parsed?.["routa-coordination"]).toMatchObject({
      command: expect.any(String),
      args: expect.arrayContaining([expect.stringContaining("mcp-http-proxy"), expect.any(String)]),
    });
  });

  it("falls back to inline JSON on non-Windows when Claude temp file writes fail", async () => {
    const invalidHomePath = path.join(tmpHome, "home-file");
    await fsp.writeFile(invalidHomePath, "not-a-directory", "utf-8");
    process.env.HOME = invalidHomePath;
    vi.resetModules();

    const { ensureMcpForProvider, parseMcpServersFromConfigs } = await import("../mcp-setup");

    const result = await ensureMcpForProvider("claude", {
      routaServerUrl: "http://127.0.0.1:3000",
      workspaceId: "ws-fallback",
      includeCustomServers: false,
    });

    expect(result.mcpConfigs).toHaveLength(1);
    expect(result.mcpConfigs[0]).toContain("\"mcpServers\"");
    expect(result.summary).toContain("inline JSON fallback");

    const parsed = parseMcpServersFromConfigs(result.mcpConfigs);
    expect(parsed?.["routa-coordination"]).toMatchObject({
      command: expect.any(String),
      args: expect.arrayContaining([expect.stringContaining("mcp-http-proxy"), expect.any(String)]),
    });
  });

  it("ignores unreadable and invalid file configs while merging valid entries", async () => {
    const { parseMcpServersFromConfigs } = await import("../mcp-setup");

    const validConfigPath = path.join(tmpHome, "valid-mcp.json");
    const invalidConfigPath = path.join(tmpHome, "invalid-mcp.json");

    await fsp.writeFile(
      validConfigPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "http", url: "http://alpha.local" },
        },
      }),
      "utf-8",
    );
    await fsp.writeFile(invalidConfigPath, "{not-json", "utf-8");

    const parsed = parseMcpServersFromConfigs([
      path.join(tmpHome, "missing.json"),
      invalidConfigPath,
      validConfigPath,
      JSON.stringify({
        mcpServers: {
          beta: { type: "http", url: "http://beta.local" },
        },
      }),
    ]);

    expect(parsed).toEqual({
      alpha: { type: "http", url: "http://alpha.local" },
      beta: { type: "http", url: "http://beta.local" },
    });
  });
});
