import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en";
import { I18nContext } from "@/i18n/context";

import { DockerStatusIndicator } from "../docker-status-indicator";

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nContext
      value={{
        locale: "en",
        setLocale: () => {},
        t: en,
      }}
    >
      {ui}
    </I18nContext>,
  );
}

describe("DockerStatusIndicator", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows the reported Docker version when available", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({
      available: true,
      daemonRunning: true,
      version: "27.5.1",
      checkedAt: new Date().toISOString(),
    })));

    renderWithI18n(<DockerStatusIndicator />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Docker 27.5.1" })).toBeTruthy();
    });
  });

  it("preserves the ready fallback when Docker is available without a version", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({
      available: true,
      daemonRunning: true,
      checkedAt: new Date().toISOString(),
    })));

    renderWithI18n(<DockerStatusIndicator />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Docker ready" })).toBeTruthy();
    });
  });
});
