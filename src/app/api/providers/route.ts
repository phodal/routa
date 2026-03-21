/**
 * Providers API - Fast provider listing with lazy status checking
 *
 * GET /api/providers - List all providers (instant, local first)
 * GET /api/providers?check=true - Check provider status (slower, but accurate)
 * GET /api/providers?registry=true - Include registry providers (slower, with timeout)
 *
 * Strategy:
 * 1. Local providers are returned immediately (< 10ms)
 * 2. Registry providers are fetched asynchronously in background
 * 3. Clients can load local first, then fetch registry separately
 */

import { NextRequest, NextResponse } from "next/server";
import { getStandardPresets, getPresetById, resolveCommand } from "@/core/acp/acp-presets";
import { which } from "@/core/acp/utils";
import { fetchRegistry, detectPlatformTarget } from "@/core/acp/acp-registry";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { isOpencodeServerConfigured } from "@/core/acp/opencode-sdk-adapter";
import { isClaudeCodeSdkConfigured } from "@/core/acp/claude-code-sdk-adapter";
import { getDockerDetector } from "@/core/acp/docker";

type ProviderStatus = "available" | "unavailable" | "checking";

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  command: string;
  status: ProviderStatus;
  source: "static" | "registry";
  unavailableReason?: string;
}

// In-memory cache with separate TTL for local and registry
const cache = {
  localProviders: null as ProviderInfo[] | null,
  registryProviders: null as ProviderInfo[] | null,
  checkedLocalProviders: null as ProviderInfo[] | null,
  checkedRegistryProviders: null as ProviderInfo[] | null,
  localTimestamp: 0,
  registryTimestamp: 0,
  checkedLocalTimestamp: 0,
  checkedRegistryTimestamp: 0,
  LOCAL_TTL: 60000, // 60 seconds for local (changes rarely)
  REGISTRY_TTL: 300000, // 5 minutes for registry (changes very rarely)
  CHECKED_LOCAL_TTL: 15000, // 15 seconds for command availability checks
  CHECKED_REGISTRY_TTL: 30000, // 30 seconds for checked registry status
};

async function getDockerProviderInfo(shouldCheck: boolean): Promise<ProviderInfo> {
  if (!shouldCheck) {
    return {
      id: "docker-opencode",
      name: "Docker OpenCode",
      description: "OpenCode in isolated Docker container",
      command: "docker run",
      status: "checking",
      source: "static",
    };
  }

  const dockerStatus = await getDockerDetector().checkAvailability();
  return {
    id: "docker-opencode",
    name: "Docker OpenCode",
    description: dockerStatus.available
      ? "OpenCode in isolated Docker container"
      : "Requires Docker/Colima daemon",
    command: "docker run",
    status: dockerStatus.available ? "available" : "unavailable",
    source: "static",
    unavailableReason: dockerStatus.available
      ? undefined
      : (dockerStatus.error ?? "Docker daemon unavailable. Start Docker Desktop or Colima."),
  };
}

/**
 * Fetch only local (static) providers - fast and reliable
 */
async function getLocalProviders(shouldCheck = false): Promise<ProviderInfo[]> {
  // Check cache first
  if (shouldCheck) {
    if (
      cache.checkedLocalProviders &&
      Date.now() - cache.checkedLocalTimestamp < cache.CHECKED_LOCAL_TTL
    ) {
      return cache.checkedLocalProviders;
    }
  } else if (cache.localProviders && Date.now() - cache.localTimestamp < cache.LOCAL_TTL) {
    return cache.localProviders;
  }

  const providers: ProviderInfo[] = [];
  const claudeSdkConfigured = isClaudeCodeSdkConfigured();
  const opencodeSdkConfigured = isOpencodeServerConfigured();

  // In serverless environments (Vercel), show SDK-based providers only
  if (isServerlessEnvironment()) {
    // Claude Code SDK - recommended for serverless
    providers.push({
      id: "claude-code-sdk",
      name: "Claude Code SDK",
      description: claudeSdkConfigured
        ? "Claude Code via SDK (configured)"
        : "Claude Code via SDK - Set ANTHROPIC_AUTH_TOKEN environment variable",
      command: "sdk",
      status: claudeSdkConfigured ? "available" : "unavailable",
      source: "static",
    });

    // OpenCode SDK - alternative for serverless
    providers.push({
      id: "opencode-sdk",
      name: "OpenCode SDK",
      description: opencodeSdkConfigured
        ? "OpenCode via SDK (configured)"
        : "OpenCode SDK - Set OPENCODE_SERVER_URL or OPENCODE_API_KEY",
      command: "sdk",
      status: opencodeSdkConfigured ? "available" : "unavailable",
      source: "static",
    });

    const availableCount = providers.filter(p => p.status === "available").length;
    console.log(`[Providers API] Serverless environment: ${availableCount}/${providers.length} SDK providers available`);
    return providers;
  }

  // In local development, expose configured SDK providers alongside CLI providers
  // so SDK-specific features can be exercised in the normal UI.
  if (claudeSdkConfigured) {
    providers.push({
      id: "claude-code-sdk",
      name: "Claude Code SDK",
      description: "Claude Code via SDK",
      command: "sdk",
      status: "available",
      source: "static",
    });
  }

  if (opencodeSdkConfigured) {
    providers.push({
      id: "opencode-sdk",
      name: "OpenCode SDK",
      description: "OpenCode via SDK",
      command: "sdk",
      status: "available",
      source: "static",
    });
  }

  providers.push(await getDockerProviderInfo(shouldCheck));

  // Non-serverless: show all CLI-based providers
  const allPresets = [...getStandardPresets()];
  const claudePreset = getPresetById("claude");
  if (claudePreset) allPresets.push(claudePreset);

  if (shouldCheck) {
    // Check availability in parallel
    const checkedProviders = await Promise.all(
      allPresets.map(async (p): Promise<ProviderInfo> => {
        const cmd = resolveCommand(p);
        const resolved = await which(cmd);
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          command: p.command,
          status: resolved ? "available" : "unavailable",
          source: "static",
        };
      })
    );
    providers.push(...checkedProviders);

    // Sort: available first
    providers.sort((a, b) => {
      if (a.status === b.status) return a.name.localeCompare(b.name);
      return a.status === "available" ? -1 : 1;
    });
  } else {
    // Return without checking (fast)
    providers.push(...allPresets.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      command: p.command,
      status: "checking" as const,
      source: "static" as const,
    })));
  }

  // Update cache
  if (shouldCheck) {
    cache.checkedLocalProviders = providers;
    cache.checkedLocalTimestamp = Date.now();
  } else {
    cache.localProviders = providers;
    cache.localTimestamp = Date.now();
  }

  return providers;
}

/**
 * Fetch registry providers with timeout protection
 */
async function getRegistryProviders(shouldCheck = false): Promise<ProviderInfo[]> {
  // Check cache first
  if (shouldCheck) {
    if (
      cache.checkedRegistryProviders &&
      Date.now() - cache.checkedRegistryTimestamp < cache.CHECKED_REGISTRY_TTL
    ) {
      return cache.checkedRegistryProviders;
    }
  } else if (
    cache.registryProviders &&
    Date.now() - cache.registryTimestamp < cache.REGISTRY_TTL
  ) {
    return cache.registryProviders;
  }

  const providers: ProviderInfo[] = [];

  try {
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Registry fetch timeout")), 8000)
    );

    const registry = await Promise.race([
      fetchRegistry(),
      timeoutPromise,
    ]) as Awaited<ReturnType<typeof fetchRegistry>>;

    const staticIds = new Set(["claude", "opencode", "gemini", "openai", "auggie", "codex", "copilot", "kimi", "kiro", "qoder"]);
    const platform = detectPlatformTarget();

    if (shouldCheck) {
      // Check npx and uvx availability
      const [npxPath, uvxPath] = await Promise.all([
        which("npx"),
        which("uv"),
      ]);

      for (const agent of registry.agents) {
        const dist = agent.distribution;
        let command = "";
        let status: ProviderStatus = "unavailable";

        if (dist.npx && npxPath) {
          command = `npx ${dist.npx.package}`;
          status = "available";
        } else if (dist.uvx && uvxPath) {
          command = `uvx ${dist.uvx.package}`;
          status = "available";
        } else if (dist.binary && platform && dist.binary[platform]) {
          command = dist.binary[platform]!.cmd ?? agent.id;
          status = "unavailable"; // Binary downloads require installation
        } else if (dist.npx) {
          command = `npx ${dist.npx.package}`;
          status = "unavailable";
        } else if (dist.uvx) {
          command = `uvx ${dist.uvx.package}`;
          status = "unavailable";
        }

        const providerId = staticIds.has(agent.id) ? `${agent.id}-registry` : agent.id;
        const providerName = staticIds.has(agent.id) ? `${agent.name} (Registry)` : agent.name;

        providers.push({
          id: providerId,
          name: providerName,
          description: agent.description,
          command,
          status,
          source: "registry",
        });
      }
    } else {
      // Return without checking (fast)
      for (const agent of registry.agents) {
        const dist = agent.distribution;
        let command = "";

        if (dist.npx) {
          command = `npx ${dist.npx.package}`;
        } else if (dist.uvx) {
          command = `uvx ${dist.uvx.package}`;
        } else if (dist.binary && platform && dist.binary[platform]) {
          command = dist.binary[platform]!.cmd ?? agent.id;
        }

        const providerId = staticIds.has(agent.id) ? `${agent.id}-registry` : agent.id;
        const providerName = staticIds.has(agent.id) ? `${agent.name} (Registry)` : agent.name;

        providers.push({
          id: providerId,
          name: providerName,
          description: agent.description,
          command,
          status: "checking",
          source: "registry",
        });
      }
    }

    // Update cache
    if (shouldCheck) {
      cache.checkedRegistryProviders = providers;
      cache.checkedRegistryTimestamp = Date.now();
    } else {
      cache.registryProviders = providers;
      cache.registryTimestamp = Date.now();
    }

    console.log(`[Providers API] Loaded ${providers.length} registry providers`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("timeout")) {
      console.warn("[Providers API] Registry fetch timed out (8s) - using cached or skipping");
    } else {
      console.warn("[Providers API] Failed to fetch registry:", errorMsg);
    }
  }

  return providers;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const shouldCheck = searchParams.get("check") === "true";
  const includeRegistry = searchParams.get("registry") === "true";

  // Fast path: return only local providers immediately
  if (!includeRegistry) {
    const providers = await getLocalProviders(shouldCheck);
    return NextResponse.json({
      providers,
      hasMore: true, // Indicates registry providers are available
    });
  }

  // Full path: include both local and registry providers
  const localProviders = await getLocalProviders(shouldCheck);
  const registryProviders = await getRegistryProviders(shouldCheck);

  const allProviders = [...localProviders, ...registryProviders];

  return NextResponse.json({
    providers: allProviders,
    hasMore: false,
  });
}
