import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RepoPicker } from "../repo-picker";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch,
}));

vi.mock("../branch-selector", () => ({
  BranchSelector: ({ currentBranch }: { currentBranch?: string }) => (
    <div data-testid="branch-selector">{currentBranch ?? ""}</div>
  ),
}));

describe("RepoPicker", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/clone" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ repos: [] }), { status: 200 });
      }

      if (url === "/api/clone/local" && init?.method === "POST") {
        const payload = init.body ? JSON.parse(String(init.body)) : {};
        return new Response(
          JSON.stringify({
            success: true,
            name: "routa-js",
            path: payload.path,
            branch: "main",
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
  });

  it("loads a local repository from the local project tab", async () => {
    const onChange = vi.fn();

    render(<RepoPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /select, clone, or load a repository/i }));
    fireEvent.click(screen.getByRole("button", { name: /local project/i }));
    fireEvent.change(screen.getByPlaceholderText("/Users/you/project or ~/project"), {
      target: { value: "~/code/routa-js" },
    });
    fireEvent.click(screen.getByRole("button", { name: /use local project/i }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        name: "routa-js",
        path: "~/code/routa-js",
        branch: "main",
      }),
    );
  });

  it("switches from search to local mode when the query looks like a file path", async () => {
    render(<RepoPicker value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /select, clone, or load a repository/i }));
    fireEvent.change(
      screen.getByPlaceholderText("Search repositories, paste GitHub URL, or enter local path..."),
      {
        target: { value: "~/code/routa-js" },
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Local Repository Path")).toBeTruthy();
      expect(
        screen.getByDisplayValue("~/code/routa-js"),
      ).toBeTruthy();
    });
  });
});
