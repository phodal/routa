import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
const createMock = vi.fn(() => ({ execute: executeMock }));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: createMock,
  },
}));

const { TauriPlatformBridge } = await import("../tauri-bridge");

describe("TauriPlatformBridge git commands", () => {
  beforeEach(() => {
    createMock.mockClear();
    executeMock.mockReset();
    executeMock.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("passes raw branch argv to checkout without literal quotes", async () => {
    const bridge = new TauriPlatformBridge();

    await bridge.git.checkout("/tmp/repo", "feature/login");

    expect(createMock).toHaveBeenCalledWith("git", ["checkout", "feature/login"], {
      cwd: "/tmp/repo",
      env: undefined,
    });
  });

  it("passes raw branch argv to pull without literal quotes", async () => {
    const bridge = new TauriPlatformBridge();

    await bridge.git.pull("/tmp/repo", "feature/login");

    expect(createMock).toHaveBeenCalledWith("git", ["pull", "origin", "feature/login"], {
      cwd: "/tmp/repo",
      env: undefined,
    });
  });
});
