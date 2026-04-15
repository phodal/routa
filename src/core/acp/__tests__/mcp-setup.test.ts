/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";
import { ensureMcpForProvider, parseMcpServersFromConfigs } from "../mcp-setup";

vi.mock("@/core/store/custom-mcp-server-store", () => ({
  getCustomMcpServerStore: () => null,
  mergeCustomMcpServers: (builtIn: Record<string, unknown>) => builtIn,
}));

describe("ensureMcpForProvider", () => {
  it("keeps Claude MCP config inline so SDK parsing still works", async () => {
    const result = await ensureMcpForProvider("claude", {
      routaServerUrl: "http://127.0.0.1:3000",
      workspaceId: "ws-test",
      includeCustomServers: false,
    });

    expect(result.mcpConfigs).toHaveLength(1);
    expect(result.mcpConfigs[0]).toContain("\"mcpServers\"");

    const parsed = parseMcpServersFromConfigs(result.mcpConfigs);
    expect(parsed?.["routa-coordination"]).toMatchObject({
      type: "http",
      url: "http://127.0.0.1:3000/api/mcp",
    });
  });
});
