import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetchMock } = vi.hoisted(() => ({
  desktopAwareFetchMock: vi.fn(),
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch: desktopAwareFetchMock,
}));

import { useFileSearch } from "../use-file-search";

function okJson(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useFileSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("debounces search requests and returns file matches", async () => {
    desktopAwareFetchMock.mockResolvedValueOnce(okJson({
      files: [
        { path: "src/app.ts", fullPath: "/repo/src/app.ts", name: "app.ts", score: 0.9 },
      ],
      total: 1,
      query: "app",
      scanned: 20,
    }));

    const { result } = renderHook(() => useFileSearch({ repoPath: "/repo", debounceMs: 5, limit: 10 }));

    act(() => {
      result.current.search("app");
    });

    expect(result.current.query).toBe("app");

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });

    expect(desktopAwareFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/files/search?q=app&repoPath=%2Frepo&limit=10"),
      expect.any(Object),
    );
  });

  it("clears results when repo is missing and resets state when repo changes", async () => {
    const { result, rerender } = renderHook(
      ({ repoPath }) => useFileSearch({ repoPath, debounceMs: 5 }),
      { initialProps: { repoPath: "/repo-a" as string | null } },
    );

    desktopAwareFetchMock.mockResolvedValueOnce(okJson({
      files: [
        { path: "src/a.ts", fullPath: "/repo-a/src/a.ts", name: "a.ts", score: 0.8 },
      ],
      total: 1,
      query: "a",
      scanned: 10,
    }));

    act(() => {
      result.current.search("a");
    });

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });

    rerender({ repoPath: "/repo-b" });

    expect(result.current.results).toEqual([]);
    expect(result.current.query).toBe("");

    rerender({ repoPath: null });

    act(() => {
      result.current.search("b");
    });

    expect(result.current.results).toEqual([]);
  });

  it("surfaces API failures and ignores aborted requests", async () => {
    desktopAwareFetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Search failed hard" }),
    });

    const { result } = renderHook(() => useFileSearch({ repoPath: "/repo", debounceMs: 5 }));

    act(() => {
      result.current.search("fail");
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Search failed hard");
    });

    desktopAwareFetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));

    act(() => {
      result.current.search("next");
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
  });
});
