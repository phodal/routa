/**
 * MCP Configuration Test API
 * 
 * GET /api/test-mcp - Test MCP configuration for all providers
 */

import { NextResponse } from "next/server";
import { setupMcpForProvider, providerSupportsMcp, type McpSupportedProvider } from "@/core/acp/mcp-setup";
import { getDefaultRoutaMcpConfig } from "@/core/acp/mcp-config-generator";

export async function GET() {
  const results: Record<string, any> = {};
  const providers = ["auggie", "codex", "opencode", "gemini", "claude"];

  for (const providerId of providers) {
    const supportsMcp = providerSupportsMcp(providerId);
    
    if (supportsMcp) {
      const mcpConfigs = setupMcpForProvider(providerId as McpSupportedProvider);
      
      try {
        const parsed = mcpConfigs.length > 0 ? JSON.parse(mcpConfigs[0]) : null;
        results[providerId] = {
          supportsMcp: true,
          configCount: mcpConfigs.length,
          config: parsed,
          rawJson: mcpConfigs[0],
        };
      } catch (e) {
        results[providerId] = {
          supportsMcp: true,
          configCount: mcpConfigs.length,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      results[providerId] = {
        supportsMcp: false,
        reason: "Provider does not support --mcp-config flag in ACP mode",
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
