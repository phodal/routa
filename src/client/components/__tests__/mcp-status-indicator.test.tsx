import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { McpStatusIndicator } from "../mcp-status-indicator";

describe("McpStatusIndicator", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows the MCP settings entry with active server summary", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        servers: [
          { id: "filesystem", enabled: true },
          { id: "github", enabled: true },
        ],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mode: "full",
        tools: new Array(12).fill({}),
      })));

    render(<McpStatusIndicator />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "MCP 3 active" })).toBeTruthy();
    });

    expect(screen.getByRole("link", { name: "MCP 3 active" }).getAttribute("href")).toBe("/settings/mcp?tab=tools");
  });

  it("falls back to an unavailable state when the status request fails", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("network error"));

    render(<McpStatusIndicator />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "MCP unavailable" })).toBeTruthy();
    });
  });
});
