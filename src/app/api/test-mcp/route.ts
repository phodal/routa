/**
 * MCP Configuration Test API
 *
 * GET /api/test-mcp - Test MCP configuration for all providers
 */

import { NextResponse } from "next/server";
import { ensureMcpForProvider, providerSupportsMcp } from "@/core/acp/mcp-setup";
import { getDefaultRoutaMcpConfig } from "@/core/acp/mcp-config-generator";

export async function GET() {
  const results: Record<string, unknown> = {};
  const providers = ["auggie", "opencode", "claude", "codex", "gemini", "kimi", "copilot", "qoder"];

  for (const providerId of providers) {
    const supported = providerSupportsMcp(providerId);

    if (supported) {
      const result = await ensureMcpForProvider(providerId);
      results[providerId] = {
        supportsMcp: true,
        summary: result.summary,
        cliArgsCount: result.mcpConfigs.length,
        cliArgs: result.mcpConfigs,
      };
    } else {
      results[providerId] = {
        supportsMcp: false,
        reason: "Provider does not support MCP via Routa",
      };
    }
  }

  const defaultConfig = getDefaultRoutaMcpConfig();

  return NextResponse.json({
    providers: results,
    defaultConfig,
    mcpEndpoint: `${defaultConfig.routaServerUrl}/api/mcp`,
  });
}
