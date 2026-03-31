import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch,
}));

vi.mock("../github-webhook-panel", () => ({
  GitHubWebhookPanel: () => <div>GitHub Webhook Panel</div>,
}));

vi.mock("../schedule-panel", () => ({
  SchedulePanel: () => <div>Schedule Panel</div>,
}));

vi.mock("../agent-install-panel", () => ({
  AgentInstallPanel: () => <div>Agent Install Panel</div>,
}));

vi.mock("../workflow-panel", () => ({
  WorkflowPanel: () => <div>Workflow Panel</div>,
}));

vi.mock("../../utils/theme", () => ({
  getStoredThemePreference: () => "light",
  resolveThemePreference: () => "light",
  setThemePreference: () => "light",
  subscribeToThemePreference: () => () => {},
}));

import { SettingsPanel } from "../settings-panel";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
});

describe("SettingsPanel render", () => {
  beforeEach(() => {
    localStorage.clear();
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/memory")) {
        return {
          ok: true,
          json: async () => ({
            current: {
              heapUsedMB: 10,
              heapTotalMB: 20,
              externalMB: 1,
              rssMB: 30,
              arrayBuffersMB: 1,
              usagePercentage: 50,
              level: "normal",
              timestamp: new Date().toISOString(),
            },
            peaks: { heapUsedMB: 10, rssMB: 30 },
            growthRateMBPerMinute: 0,
            sessionStore: {
              sessionCount: 1,
              activeSseCount: 0,
              streamingCount: 0,
              totalHistoryMessages: 0,
              totalPendingNotifications: 0,
              staleSessionCount: 0,
            },
            recommendations: [],
          }),
        };
      }
      return { ok: true, json: async () => ({ specialists: [] }) };
    });
  });

  it("renders the models tab through the extracted component", async () => {
    render(
      <SettingsPanel
        open
        onClose={() => {}}
        providers={[]}
        initialTab="models"
      />,
    );

    expect(screen.getAllByText("Add Model").length).toBeGreaterThan(0);
    expect(screen.getByText("Models")).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/Memory 10\/20 MB/)).not.toBeNull();
    });
  });

  it("renders ACP registry in its own tab instead of the providers tab", async () => {
    render(
      <SettingsPanel
        open
        onClose={() => {}}
        providers={[]}
        initialTab="providers"
      />,
    );

    expect(screen.queryByText("Agent Install Panel")).toBeNull();

    cleanup();

    render(
      <SettingsPanel
        open
        onClose={() => {}}
        providers={[]}
        initialTab="registry"
      />,
    );

    expect(screen.getByText("Agent Install Panel")).not.toBeNull();
  });
});
