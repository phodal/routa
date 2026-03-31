import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({
  pathname: "/workspace/default/kanban",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
}));

import { DesktopSidebar } from "../desktop-sidebar";

describe("DesktopSidebar", () => {
  it("prioritizes Kanban and exposes Overview as a secondary workspace entry", () => {
    render(<DesktopSidebar workspaceId="default" />);

    const links = screen.getAllByRole("link").slice(0, 4);
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Kanban", "Overview", "Team"]);

    expect(screen.getByRole("link", { name: "Kanban" }).getAttribute("href")).toBe("/workspace/default/kanban");
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/workspace/default/overview");
  });

  it("keeps the Harness entry available with the workspace-aware settings link", () => {
    render(<DesktopSidebar workspaceId="default" />);

    expect(screen.getByRole("link", { name: "Harness" }).getAttribute("href")).toBe(
      "/settings/harness?workspaceId=default",
    );
  });
});
