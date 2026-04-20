import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentInstallPanel } from "../agent-install-panel";

const {
  isTauriRuntimeMock,
  desktopAwareFetchMock,
} = vi.hoisted(() => ({
  isTauriRuntimeMock: vi.fn(() => false),
  desktopAwareFetchMock: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <div data-testid="mock-image">{props.alt ?? ""}</div>,
}));

vi.mock("@/client/utils/diagnostics", () => ({
  isTauriRuntime: isTauriRuntimeMock,
  desktopAwareFetch: desktopAwareFetchMock,
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        loading: "Loading",
        refresh: "Refresh",
        dismiss: "Dismiss",
        unavailable: "Unavailable",
      },
      agents: {
        failedToLoad: "Failed to load",
        installFailed: "Install failed",
        uninstallFailed: "Uninstall failed",
        acpRegistryTitle: "ACP Registry",
        searchAgents: "Search agents",
        loadingFromRegistry: "Loading from registry",
        noMatchingAgents: "No matching agents",
        noAgentsAvailable: "No agents available",
        platformRegistry: "Platform {platform} registry {registry}",
        unknownPlatform: "unknown",
        installed: "Installed",
        available: "Available",
        uninstall: "Uninstall",
        installing: "Installing",
        install: "Install",
        viewRepository: "View repository",
      },
    },
  }),
}));

function registryResponse() {
  return {
    agents: [
      {
        agent: {
          id: "crafter",
          name: "Crafter",
          version: "1.0.0",
          description: "Writes code",
          repository: "https://github.com/acme/crafter",
          authors: ["Routa"],
          license: "MIT",
        },
        available: false,
        installed: false,
        uninstallable: false,
        distributionTypes: ["npx", "binary"],
      },
      {
        agent: {
          id: "reviewer",
          name: "Reviewer",
          version: "2.0.0",
          description: "Reviews code",
          authors: ["Routa"],
          license: "Apache-2.0",
        },
        available: true,
        installed: true,
        uninstallable: true,
        distributionTypes: ["uvx"],
      },
    ],
    platform: "darwin",
    runtimeAvailability: {
      npx: true,
      uvx: false,
    },
  };
}

function responseLike(data: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => data,
  } as unknown as Response;
}

describe("AgentInstallPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntimeMock.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => responseLike(registryResponse())));
  });

  it("loads registry agents, filters by search, and refreshes", async () => {
    render(<AgentInstallPanel />);

    expect(await screen.findByText("Crafter")).not.toBeNull();
    expect(screen.getByText("Reviewer")).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Search agents"), {
      target: { value: "review" },
    });

    expect(screen.queryByText("Crafter")).toBeNull();
    expect(screen.getByText("Reviewer")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/acp/registry?refresh=true");
    });
  });

  it("installs and uninstalls agents through the web API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/acp/registry")) {
        return responseLike(registryResponse());
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    desktopAwareFetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    render(<AgentInstallPanel />);

    expect(await screen.findByText("Crafter")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => {
      expect(desktopAwareFetchMock).toHaveBeenCalledWith("/api/acp/install", expect.objectContaining({
        method: "POST",
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    await waitFor(() => {
      expect(desktopAwareFetchMock).toHaveBeenCalledWith("/api/acp/install", expect.objectContaining({
        method: "DELETE",
      }));
    });
  });

  it("shows registry and install errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseLike({}, { ok: false, status: 500 })) as unknown as typeof fetch);

    render(<AgentInstallPanel embedded />);

    expect(await screen.findByText("Failed to fetch registry: 500")).not.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => responseLike(registryResponse())) as unknown as typeof fetch);

    desktopAwareFetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Install exploded" }),
    });

    render(<AgentInstallPanel embedded />);

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    expect(await screen.findByText("Install exploded")).not.toBeNull();
  });
});
