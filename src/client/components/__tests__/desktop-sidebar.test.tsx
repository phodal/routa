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
  it("keeps Home, Sessions, Kanban, and Team in the primary navigation", () => {
    render(<DesktopSidebar workspaceId="default" />);

    const links = screen.getAllByRole("link").slice(0, 4);
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Sessions", "Kanban", "Team"]);

    expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe("/workspace/default/sessions");
    expect(screen.getByRole("link", { name: "Kanban" }).getAttribute("href")).toBe("/workspace/default/kanban");
    expect(screen.getByRole("link", { name: "Team" }).getAttribute("href")).toBe("/workspace/default/team");
  });

  it("keeps Harness and Fluency in the lower menu and uses a direct settings link", () => {
    render(<DesktopSidebar workspaceId="default" />);

    expect(screen.queryByRole("link", { name: "MCP Servers" })).toBeNull();
    expect(screen.getByRole("link", { name: "Harness" }).getAttribute("href")).toBe("/settings/harness?workspaceId=default");
    expect(screen.queryByRole("link", { name: "Spec" })).toBeNull();
    expect(screen.getByRole("link", { name: "Fluency" }).getAttribute("href")).toBe("/settings/fluency?workspaceId=default");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings?workspaceId=default");
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("does not mark Settings as active when a settings tool page is active", () => {
    pathnameState.pathname = "/settings/harness";

    render(<DesktopSidebar workspaceId="default" />);

    expect(screen.getByRole("link", { name: "Harness" }).className).toContain("text-desktop-accent");
    expect(screen.getByRole("link", { name: "Settings" }).className).not.toContain("text-desktop-accent");
  });

  it("shows a collapse icon when expanded and an expand icon when collapsed", () => {
    const { rerender } = render(<DesktopSidebar workspaceId="default" collapsed={false} />);

    const expandedToggle = screen.getByRole("button", { name: "Close sidebar" });
    expect(expandedToggle.querySelector("path")?.getAttribute("d")).toBe(
      "M13.5 4.5 6 12l7.5 7.5M18 4.5 10.5 12 18 19.5",
    );

    rerender(<DesktopSidebar workspaceId="default" collapsed />);

    const collapsedToggle = screen.getByRole("button", { name: "Open sidebar" });
    expect(collapsedToggle.querySelector("path")?.getAttribute("d")).toBe(
      "M10.5 4.5 18 12l-7.5 7.5M6 4.5 13.5 12 6 19.5",
    );
  });
});
