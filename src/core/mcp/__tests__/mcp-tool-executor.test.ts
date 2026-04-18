import { describe, expect, it } from "vitest";

import { executeMcpTool } from "../mcp-tool-executor";

describe("executeMcpTool", () => {
  it("reads specialist spec resources without requiring workspaceId", async () => {
    const result = await executeMcpTool(
      {} as never,
      "read_specialist_spec_resource",
      { uri: "resource://routa/specialists/feature-tree/manifest" },
    );

    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    const payload = JSON.parse((result as { content: Array<{ text: string }> }).content[0]?.text ?? "{}") as {
      text?: string;
    };
    expect(payload.text).toContain(
      '"baseRulesInPrompt": true',
    );
  });
});
