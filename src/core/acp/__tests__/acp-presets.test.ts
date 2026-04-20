import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRole, ModelTier } from "@/core/models/agent";

const { mockBridge, mockWhich, mockFetchRegistry, mockGetRegistryAgent, mockBuildAgentCommand } = vi.hoisted(() => ({
  mockBridge: {
    env: {
      osPlatform: vi.fn(() => "linux"),
      getEnv: vi.fn(() => undefined),
      currentDir: vi.fn(() => "/repo"),
    },
    fs: {
      existsSync: vi.fn(() => false),
    },
  },
  mockWhich: vi.fn(async () => null),
  mockFetchRegistry: vi.fn(async () => ({
    version: "1.0.0",
    agents: [
      {
        id: "registry-only",
        name: "Registry Only",
        version: "2.0.0",
        description: "Registry-only ACP agent",
        authors: ["ACP"],
        license: "MIT",
        icon: "https://example.com/icon.png",
        repository: "https://example.com/repo",
        distribution: { npx: { package: "@acp/registry-only" } },
      },
      {
        id: "auggie",
        name: "Auggie Registry",
        version: "9.9.9",
        description: "Registry metadata for Auggie",
        authors: ["ACP"],
        license: "Apache-2.0",
        icon: "https://example.com/auggie.png",
        repository: "https://example.com/auggie",
        distribution: { npx: { package: "@acp/auggie" } },
      },
    ],
  })),
  mockGetRegistryAgent: vi.fn(async (id: string) => {
    if (id === "registry-only") {
      return {
        id,
        name: "Registry Only",
        version: "2.0.0",
        description: "Registry-only ACP agent",
        authors: ["ACP"],
        license: "MIT",
        icon: "https://example.com/icon.png",
        repository: "https://example.com/repo",
        distribution: { npx: { package: "@acp/registry-only" } },
      };
    }
    if (id === "auggie") {
      return {
        id,
        name: "Auggie Registry",
        version: "9.9.9",
        description: "Registry metadata for Auggie",
        authors: ["ACP"],
        license: "Apache-2.0",
        icon: "https://example.com/auggie.png",
        repository: "https://example.com/auggie",
        distribution: { npx: { package: "@acp/auggie" } },
      };
    }
    return undefined;
  }),
  mockBuildAgentCommand: vi.fn(async (id: string) => {
    if (id === "registry-only") {
      return {
        command: "npx",
        args: ["-y", "@acp/registry-only"],
        env: { ACP_TOKEN: "present" },
      };
    }
    if (id === "auggie") {
      return {
        command: "uvx",
        args: ["auggie", "--acp"],
        env: undefined,
      };
    }
    return null;
  }),
}));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => mockBridge,
}));

vi.mock("../utils", () => ({
  which: mockWhich,
}));

vi.mock("../acp-registry", () => ({
  fetchRegistry: mockFetchRegistry,
  getRegistryAgent: mockGetRegistryAgent,
}));

vi.mock("../acp-installer", () => ({
  buildAgentCommand: mockBuildAgentCommand,
}));

import {
  ACP_AGENT_PRESETS,
  fetchRegistryPresets,
  getAllAvailablePresets,
  getDefaultPreset,
  getPresetById,
  getPresetByIdWithRegistry,
  getRegistryPresetById,
  getStandardPresets,
  registryAgentToPreset,
  syncPresetsWithRegistry,
} from "../acp-presets";

describe("acp-presets", () => {
  beforeEach(() => {
    mockBridge.env.osPlatform.mockReset();
    mockBridge.env.osPlatform.mockReturnValue("linux");
    mockBridge.env.getEnv.mockReset();
    mockBridge.env.getEnv.mockReturnValue(undefined);
    mockBridge.env.currentDir.mockReset();
    mockBridge.env.currentDir.mockReturnValue("/repo");
    mockBridge.fs.existsSync.mockReset();
    mockBridge.fs.existsSync.mockReturnValue(false);
    mockWhich.mockReset();
    mockWhich.mockResolvedValue(null);
    mockFetchRegistry.mockClear();
    mockGetRegistryAgent.mockClear();
    mockBuildAgentCommand.mockClear();
  });

  it("exposes stable static preset helpers", () => {
    expect(getPresetById("codex")).toMatchObject({
      id: "codex",
      preferredTier: ModelTier.SMART,
      supportedRoles: [AgentRole.CRAFTER, AgentRole.DEVELOPER],
    });
    expect(getDefaultPreset().id).toBe("opencode");
    expect(getStandardPresets().every((preset) => !preset.nonStandardApi)).toBe(true);
    expect(ACP_AGENT_PRESETS.some((preset) => preset.id === "claude" && preset.nonStandardApi)).toBe(true);
  });

  it("converts and fetches registry presets with distribution metadata", async () => {
    const manual = registryAgentToPreset(
      {
        id: "manual",
        name: "Manual",
        version: "1.2.3",
        description: "Manual registry agent",
        authors: ["ACP"],
        license: "MIT",
        icon: "https://example.com/manual.png",
        repository: "https://example.com/manual",
        distribution: {},
      },
      "uvx",
      ["manual", "--acp"],
      "uvx",
      { TOKEN: "1" },
    );

    expect(manual).toMatchObject({
      id: "manual",
      source: "registry",
      distributionType: "uvx",
      env: { TOKEN: "1" },
    });

    const fetched = await fetchRegistryPresets();
    expect(fetched).toHaveLength(2);
    expect(fetched[0]).toMatchObject({
      id: "registry-only",
      source: "registry",
      distributionType: "npx",
    });
    expect(fetched[1]).toMatchObject({
      id: "auggie",
      distributionType: "uvx",
    });
  });

  it("looks up presets across static and registry sources", async () => {
    await expect(getRegistryPresetById("registry-only")).resolves.toMatchObject({
      id: "registry-only",
      command: "npx",
      distributionType: "npx",
    });
    await expect(getRegistryPresetById("missing")).resolves.toBeNull();

    await expect(getPresetByIdWithRegistry("codex")).resolves.toMatchObject({
      id: "codex",
      source: "static",
    });
    await expect(getPresetByIdWithRegistry("registry-only")).resolves.toMatchObject({
      id: "registry-only",
      source: "registry",
    });
    await expect(getPresetByIdWithRegistry("auggie-registry")).resolves.toMatchObject({
      id: "auggie-registry",
      source: "registry",
      distributionType: "uvx",
    });
    await expect(getPresetByIdWithRegistry("missing-registry")).resolves.toBeUndefined();
  });

  it("merges static and registry data without duplicating static IDs", async () => {
    const presets = await getAllAvailablePresets();
    expect(presets.filter((preset) => preset.id === "auggie")).toHaveLength(1);
    expect(presets.some((preset) => preset.id === "registry-only")).toBe(true);

    const synced = await syncPresetsWithRegistry();
    const auggie = synced.find((preset) => preset.id === "auggie");
    const codex = synced.find((preset) => preset.id === "codex");
    expect(auggie).toMatchObject({
      source: "static",
      version: "9.9.9",
      icon: "https://example.com/auggie.png",
    });
    expect(codex?.source).toBe("static");
    expect(codex?.version).toBeUndefined();
  });
});
