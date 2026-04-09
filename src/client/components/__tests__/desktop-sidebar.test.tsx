import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({
  pathname: "/workspace/default/kanban",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
}));

import { DesktopSidebar } from "../desktop-sidebar";

describe("DesktopSidebar", () => {
  it("keeps only Home, Kanban, and Overview in the primary navigation", () => {
    render(<DesktopSidebar workspaceId="default" />);

    const links = screen.getAllByRole("link").slice(0, 3);
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Kanban", "Overview"]);

    expect(screen.getByRole("link", { name: "Kanban" }).getAttribute("href")).toBe("/workspace/default/kanban");
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/workspace/default/overview");
  });

  it("moves advanced workspace tools into the Advanced menu", () => {
    render(<DesktopSidebar workspaceId="default" />);

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(screen.getByRole("link", { name: "Team" }).getAttribute("href")).toBe("/workspace/default/team");
    expect(screen.getByRole("link", { name: "Harness" }).getAttribute("href")).toBe(
      "/settings/harness?workspaceId=default",
    );
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
