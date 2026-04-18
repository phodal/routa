import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../spec-page-client", () => ({
  SpecPageClient: () => <div data-testid="spec-page-client">spec client</div>,
}));

import WorkspaceSpecPage, { generateStaticParams } from "../page";

describe("workspace spec page", () => {
  it("renders the client shell", () => {
    render(<WorkspaceSpecPage />);

    expect(screen.getByTestId("spec-page-client").textContent).toContain("spec client");
  });

  it("keeps the placeholder static params for static export", async () => {
    const original = process.env.ROUTA_BUILD_STATIC;
    process.env.ROUTA_BUILD_STATIC = "1";

    try {
      await expect(generateStaticParams()).resolves.toEqual([{ workspaceId: "__placeholder__" }]);
    } finally {
      process.env.ROUTA_BUILD_STATIC = original;
    }
  });
});
