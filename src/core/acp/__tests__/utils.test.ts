import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBridge } = vi.hoisted(() => ({
  mockBridge: {
    env: {
      osPlatform: vi.fn(() => "linux"),
      currentDir: vi.fn(() => "/repo"),
    },
    fs: {
      existsSync: vi.fn(() => false),
      statSync: vi.fn(),
    },
    process: {
      which: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => mockBridge,
}));

import { needsShell, quoteShellCommandPath, which } from "../utils";

beforeEach(() => {
  mockBridge.env.osPlatform.mockReset();
  mockBridge.env.osPlatform.mockReturnValue("linux");
  mockBridge.env.currentDir.mockReset();
  mockBridge.env.currentDir.mockReturnValue("/repo");
  mockBridge.fs.existsSync.mockReset();
  mockBridge.fs.existsSync.mockReturnValue(false);
  mockBridge.fs.statSync.mockReset();
  mockBridge.process.which.mockReset();
  mockBridge.process.which.mockResolvedValue(null);
});

describe("needsShell", () => {
  it("returns true for .cmd files", () => {
    expect(needsShell("C:\\Program Files\\nodejs\\npx.cmd")).toBe(true);
    expect(needsShell("npx.cmd")).toBe(true);
    expect(needsShell("script.CMD")).toBe(true);
  });

  it("returns true for .bat files", () => {
    expect(needsShell("C:\\scripts\\build.bat")).toBe(true);
    expect(needsShell("test.bat")).toBe(true);
    expect(needsShell("SCRIPT.BAT")).toBe(true);
  });

  it("returns false for non-shell files", () => {
    expect(needsShell("C:\\Program Files\\nodejs\\node.exe")).toBe(false);
    expect(needsShell("/usr/bin/node")).toBe(false);
    expect(needsShell("script.sh")).toBe(false);
    expect(needsShell("program")).toBe(false);
  });
});

describe("quoteShellCommandPath", () => {
  describe("paths that should be quoted", () => {
    it("quotes .cmd paths with whitespace", () => {
      const path = "C:\\Program Files\\nodejs\\npx.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .bat paths with whitespace", () => {
      const path = "C:\\My Scripts\\build.bat";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with ampersand", () => {
      const path = "C:\\Users\\R&D\\AppData\\Roaming\\npm\\npx.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with parentheses", () => {
      const path = "C:\\Program Files (x86)\\Tool\\script.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .bat paths with caret", () => {
      const path = "C:\\Path^With^Caret\\script.bat";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with pipe", () => {
      const path = "C:\\Path|With|Pipe\\script.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with less/greater than", () => {
      expect(quoteShellCommandPath("C:\\Path<Test\\script.cmd")).toBe(
        '"C:\\Path<Test\\script.cmd"'
      );
      expect(quoteShellCommandPath("C:\\Path>Test\\script.cmd")).toBe(
        '"C:\\Path>Test\\script.cmd"'
      );
    });

    it("quotes .cmd paths without special characters for consistency", () => {
      // The enhancement suggests quoting all shell commands for robustness
      const path = "C:\\Users\\John\\AppData\\Roaming\\npm\\npx.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });
  });

  describe("paths that should not be quoted", () => {
    it("does not quote non-shell executables with whitespace", () => {
      const path = "C:\\Program Files\\nodejs\\node.exe";
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("does not quote Unix paths", () => {
      const path = "/usr/local/bin/node";
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("does not quote .sh files even with whitespace", () => {
      const path = "/home/user/my scripts/build.sh";
      expect(quoteShellCommandPath(path)).toBe(path);
    });
  });

  describe("already quoted paths", () => {
    it("does not double-quote already quoted .cmd paths", () => {
      const path = '"C:\\Program Files\\nodejs\\npx.cmd"';
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("does not double-quote already quoted .bat paths", () => {
      const path = '"C:\\My Scripts\\build.bat"';
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("handles paths with internal quotes correctly", () => {
      // Edge case: path already has quotes at start and end
      const quotedPath = '"C:\\Users\\R&D\\script.cmd"';
      expect(quoteShellCommandPath(quotedPath)).toBe(quotedPath);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(quoteShellCommandPath("")).toBe("");
    });

    it("handles paths with mixed case extensions", () => {
      expect(quoteShellCommandPath("C:\\Path\\Script.Cmd")).toBe(
        '"C:\\Path\\Script.Cmd"'
      );
      expect(quoteShellCommandPath("C:\\Path\\Script.BaT")).toBe(
        '"C:\\Path\\Script.BaT"'
      );
    });

    it("handles paths with multiple special characters", () => {
      const path = "C:\\R&D (Test)\\App^Data\\script.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });
  });
});

describe("which", () => {
  it("returns an absolute path when the file exists", async () => {
    mockBridge.fs.statSync.mockReturnValue({ isFile: true });

    await expect(which("/usr/local/bin/codex")).resolves.toBe("/usr/local/bin/codex");
    expect(mockBridge.fs.statSync).toHaveBeenCalledWith("/usr/local/bin/codex");
  });

  it("returns null for missing absolute paths", async () => {
    mockBridge.fs.statSync.mockImplementation(() => {
      throw new Error("missing");
    });

    await expect(which("/missing/codex")).resolves.toBeNull();
  });

  it("prefers local node_modules binaries on non-Windows", async () => {
    mockBridge.fs.existsSync.mockImplementation(((candidate: string) => candidate === "/repo/node_modules/.bin/codex") as any);
    mockBridge.fs.statSync.mockReturnValue({ isFile: true });

    await expect(which("codex")).resolves.toBe("/repo/node_modules/.bin/codex");
    expect(mockBridge.process.which).not.toHaveBeenCalled();
  });

  it("prefers .cmd wrappers from node_modules on Windows", async () => {
    mockBridge.env.osPlatform.mockReturnValue("win32");
    mockBridge.fs.existsSync.mockImplementation(((candidate: string) => candidate === "/repo/node_modules/.bin/codex.cmd") as any);
    mockBridge.fs.statSync.mockReturnValue({ isFile: true });

    await expect(which("codex")).resolves.toBe("/repo/node_modules/.bin/codex.cmd");
  });

  it("falls back to PATH lookup and prefers spawnable Windows extensions", async () => {
    mockBridge.env.osPlatform.mockReturnValue("win32");
    mockBridge.process.which.mockResolvedValue(
      [
        "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex",
        "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd",
        "C:\\Windows\\System32\\codex.exe",
      ].join("\n") as any,
    );

    await expect(which("codex")).resolves.toBe("C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd");
  });

  it("returns the resolved PATH entry on non-Windows", async () => {
    mockBridge.process.which.mockResolvedValue("/usr/bin/codex" as any);

    await expect(which("codex")).resolves.toBe("/usr/bin/codex");
  });
});
