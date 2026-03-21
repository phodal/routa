/**
 * ACP Registry API Route - /api/acp/registry
 *
 * Provides access to the ACP agent registry with installation status.
 *
 * GET  /api/acp/registry           - List all agents with status
 * GET  /api/acp/registry?id=x      - Get specific agent details
 * POST /api/acp/registry/refresh   - Force refresh registry cache
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchRegistry,
  getRegistryAgent,
  clearRegistryCache,
  detectPlatformTarget,
  type RegistryAgent,
} from "@/core/acp/acp-registry";
import {
  listAgentsWithStatus,
  isNpxAvailable,
  isUvxAvailable,
  getAgentStatus,
  type DistributionType,
} from "@/core/acp/acp-installer";
import { ACP_AGENT_PRESETS, resolveCommand } from "@/core/acp/acp-presets";
import { which } from "@/core/acp/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("id");
  const refresh = request.nextUrl.searchParams.get("refresh") === "true";

  try {
    // Force refresh if requested
    if (refresh) {
      clearRegistryCache();
    }

    // Get specific agent
    if (agentId) {
      const agent = await getRegistryAgent(agentId);
      if (!agent) {
        return NextResponse.json(
          { error: `Agent "${agentId}" not found` },
          { status: 404 }
        );
      }

      const status = await getAgentStatus(agentId);
      const platform = detectPlatformTarget();

      return NextResponse.json({
        agent,
        available: status.available,
        installed: status.installed,
        uninstallable: status.uninstallable,
        platform,
        distributionType: status.resolvedDistributionType,
      });
    }

    // List all agents with status
    const [registryAgents, npxAvailable, uvxAvailable] = await Promise.all([
      listAgentsWithStatus(),
      isNpxAvailable(),
      isUvxAvailable(),
    ]);

    const platform = detectPlatformTarget();

    // Build a set of registry agent IDs for deduplication
    const registryIds = new Set(registryAgents.map((a) => a.agent.id));

    // Add built-in presets that are NOT in the registry (so they still appear in the install panel)
    const builtinAgents: Array<{
      agent: RegistryAgent;
      available: boolean;
      installed: boolean;
      uninstallable: boolean;
      distributionTypes: DistributionType[];
      source: "builtin";
    }> = [];

    for (const preset of ACP_AGENT_PRESETS) {
      if (preset.nonStandardApi) continue; // skip claude (non-standard)
      if (registryIds.has(preset.id)) continue; // registry version takes precedence
      const cmd = resolveCommand(preset);
      const resolved = await which(cmd);
      builtinAgents.push({
        agent: {
          id: preset.id,
          name: preset.name,
          version: preset.version ?? "",
          description: preset.description,
          repository: preset.repository,
          authors: [],
          license: preset.license ?? "",
          icon: preset.icon,
          distribution: {},
        },
        available: resolved !== null,
        installed: resolved !== null,
        uninstallable: false,
        distributionTypes: [],
        source: "builtin",
      });
    }

    // Merge: registry agents first, then built-in extras
    const agents = [
      ...registryAgents.map((a) => ({ ...a, source: "registry" as const })),
      ...builtinAgents,
    ];

    return NextResponse.json({
      agents,
      platform,
      runtimeAvailability: {
        npx: npxAvailable,
        uvx: uvxAvailable,
      },
    });
  } catch (error) {
    console.error("[ACP Registry API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch registry" },
      { status: 500 }
    );
  }
}

export async function POST(_request: NextRequest) {
  try {
    // Force refresh the registry cache
    clearRegistryCache();
    const registry = await fetchRegistry(true);

    return NextResponse.json({
      success: true,
      version: registry.version,
      agentCount: registry.agents.length,
      message: "Registry cache refreshed",
    });
  } catch (error) {
    console.error("[ACP Registry API] Refresh error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh registry" },
      { status: 500 }
    );
  }
}
