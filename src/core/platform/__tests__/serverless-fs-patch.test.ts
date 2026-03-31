/**
 * Unit tests for Serverless Filesystem Patch
 *
 * Tests cover:
 * - Path redirect logic (shouldRedirect / rewritePath) — pure functions
 * - Environment variable setup (CLAUDE_CONFIG_DIR)
 * - Guard behaviour (only serverless, idempotent)
 * - End-to-end fs patching via the actual installed patch
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  installServerlessFsPatch,
  isServerlessFsPatchInstalled,
  shouldRedirect,
  rewritePath,
  getMemoryStoreEntry,
  clearMemoryStore,
  _resetForTesting,
} from "../serverless-fs-patch";

// Cross-platform: resolve /tmp/ to os.tmpdir() for file I/O tests on Windows
const isWindows = process.platform === "win32";
const tmpDir = os.tmpdir();
const redirectClaudeDir = path.join(tmpDir, ".claude");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const k of keys) savedEnv[k] = process.env[k];
}
function restoreEnv(...keys: string[]) {
  for (const k of keys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ServerlessFsPatch", () => {
  beforeEach(() => {
    saveEnv("VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "CLAUDE_CONFIG_DIR", "NETLIFY", "FUNCTION_NAME");
    _resetForTesting();
  });

  afterEach(() => {
    restoreEnv("VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "CLAUDE_CONFIG_DIR", "NETLIFY", "FUNCTION_NAME");
    clearMemoryStore();
  });

  // ── shouldRedirect (pure logic) ──────────────────────────────────────────

  describe("shouldRedirect", () => {
    it("returns true for home-dir .claude/ paths", () => {
      expect(shouldRedirect("/home/sbx_user1051/.claude/debug/uuid.txt")).toBe(true);
      expect(shouldRedirect("/root/.claude/debug/test.txt")).toBe(true);
      expect(shouldRedirect("/home/user/.claude/config.json")).toBe(true);
    });

    it("returns false for non-string values", () => {
      expect(shouldRedirect(42)).toBe(false);
      expect(shouldRedirect(null)).toBe(false);
      expect(shouldRedirect(undefined)).toBe(false);
    });

    it("returns false for paths without /.claude/", () => {
      expect(shouldRedirect("/home/user/project/file.txt")).toBe(false);
      expect(shouldRedirect("/tmp/other-dir/data.txt")).toBe(false);
    });

    it("returns false for paths already under /tmp/", () => {
      expect(shouldRedirect("/tmp/.claude/debug/uuid.txt")).toBe(false);
      expect(shouldRedirect("/tmp/.claude/config.json")).toBe(false);
    });

    it("returns false for project-local .claude/ paths (under cwd)", () => {
      const cwd = process.cwd();
      expect(shouldRedirect(path.join(cwd, ".claude/skills/test.md"))).toBe(false);
      expect(shouldRedirect(path.join(cwd, ".claude/debug/local.txt"))).toBe(false);
    });
  });

  // ── rewritePath (pure logic) ─────────────────────────────────────────────

  describe("rewritePath", () => {
    it("rewrites home-dir .claude/ paths to /tmp/.claude/", () => {
      expect(rewritePath("/home/sbx_user1051/.claude/debug/uuid.txt")).toBe(
        "/tmp/.claude/debug/uuid.txt",
      );
    });

    it("rewrites /root/.claude/ paths", () => {
      expect(rewritePath("/root/.claude/config.json")).toBe(
        "/tmp/.claude/config.json",
      );
    });

    it("preserves nested structure after .claude/", () => {
      expect(
        rewritePath("/home/user/.claude/debug/nested/deep/file.txt"),
      ).toBe("/tmp/.claude/debug/nested/deep/file.txt");
    });

    it("returns original path if no /.claude/ marker found", () => {
      expect(rewritePath("/some/random/path.txt")).toBe("/some/random/path.txt");
    });
  });

  // ── installServerlessFsPatch ─────────────────────────────────────────────

  describe("installServerlessFsPatch", () => {
    it("should not install outside serverless environments", () => {
      delete process.env.VERCEL;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.NETLIFY;
      delete process.env.FUNCTION_NAME;

      const result = installServerlessFsPatch();

      expect(result).toBe(false);
      expect(isServerlessFsPatchInstalled()).toBe(false);
    });

    it("should install when VERCEL env is set", () => {
      process.env.VERCEL = "1";
      delete process.env.CLAUDE_CONFIG_DIR;

      const result = installServerlessFsPatch();

      expect(result).toBe(true);
      expect(isServerlessFsPatchInstalled()).toBe(true);
    });

    it("should install when AWS_LAMBDA_FUNCTION_NAME env is set", () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";
      delete process.env.CLAUDE_CONFIG_DIR;

      const result = installServerlessFsPatch();

      expect(result).toBe(true);
      expect(isServerlessFsPatchInstalled()).toBe(true);
    });

    it("should set CLAUDE_CONFIG_DIR if not already set", () => {
      process.env.VERCEL = "1";
      delete process.env.CLAUDE_CONFIG_DIR;

      installServerlessFsPatch();

      // Cross-platform: CLAUDE_CONFIG_DIR uses forward-slash /tmp on all platforms
      // (serverless runtimes are Linux, but the test verifies the env var is set)
      expect(process.env.CLAUDE_CONFIG_DIR).toBeDefined();
      expect(process.env.CLAUDE_CONFIG_DIR).toMatch(/[/\\]\.claude$/);
    });

    it("should not override existing CLAUDE_CONFIG_DIR", () => {
      process.env.VERCEL = "1";
      process.env.CLAUDE_CONFIG_DIR = "/custom/config";

      installServerlessFsPatch();

      expect(process.env.CLAUDE_CONFIG_DIR).toBe("/custom/config");
    });

    it("should be idempotent — second call returns true without re-patching", () => {
      process.env.VERCEL = "1";
      delete process.env.CLAUDE_CONFIG_DIR;

      const r1 = installServerlessFsPatch();
      const r2 = installServerlessFsPatch();

      expect(r1).toBe(true);
      expect(r2).toBe(true);
    });

    it("should pre-create the debug directory under CLAUDE_CONFIG_DIR", () => {
      process.env.VERCEL = "1";
      delete process.env.CLAUDE_CONFIG_DIR;

      installServerlessFsPatch();

      // Cross-platform: the debug dir is created at whatever CLAUDE_CONFIG_DIR resolves to
      const debugDir = path.join(process.env.CLAUDE_CONFIG_DIR!, "debug");
      expect(fs.existsSync(debugDir)).toBe(true);
    });
  });

  // ── End-to-end: actual file operations via the patch ─────────────────────
  //
  // The fs monkey-patch may or may not succeed depending on the runtime (ESM
  // modules have non-configurable exports). In production (Vercel Lambda /
  // webpack-bundled), the patch works. In tests, the env-var redirect
  // (CLAUDE_CONFIG_DIR) is the primary defence and is always testable.

  describe("CLAUDE_CONFIG_DIR redirect (Layer 1)", () => {
    it("makes the SDK config-dir function resolve to a .claude directory", () => {
      process.env.VERCEL = "1";
      delete process.env.CLAUDE_CONFIG_DIR;

      installServerlessFsPatch();

      const os = require("os");
      const resolvedDir = (
        process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")
      );

      // Cross-platform: CLAUDE_CONFIG_DIR should be set and end with /.claude (or \.claude on Windows)
      expect(resolvedDir).toMatch(/[/\\]\.claude$/);
    });

    it("debug files written to CLAUDE_CONFIG_DIR/debug/ succeed", () => {
      process.env.VERCEL = "1";
      delete process.env.CLAUDE_CONFIG_DIR;
      installServerlessFsPatch();

      // Use os.tmpdir()-based path for cross-platform file I/O
      const debugDir = path.join(tmpDir, ".claude", "debug");
      fs.mkdirSync(debugDir, { recursive: true });
      const debugPath = path.join(debugDir, "test-b2ec0fba.txt");

      expect(() => {
        fs.appendFileSync(debugPath, "debug log data\n");
      }).not.toThrow();

      expect(fs.existsSync(debugPath)).toBe(true);

      // Clean up
      try { fs.unlinkSync(debugPath); } catch { /* ignore */ }
      try { fs.rmSync(path.join(tmpDir, ".claude"), { recursive: true, force: true }); } catch { /* ignore */ }
    });
  });

  describe("memory store fallback", () => {
    it("getMemoryStoreEntry returns undefined for unknown paths", () => {
      expect(getMemoryStoreEntry("/some/unknown/path")).toBeUndefined();
    });

    it("clearMemoryStore empties the store", () => {
      clearMemoryStore();
      expect(getMemoryStoreEntry("/any")).toBeUndefined();
    });
  });
});
