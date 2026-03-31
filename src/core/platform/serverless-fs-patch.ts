/**
 * Serverless Filesystem Patch for Vercel / AWS Lambda Environments
 *
 * Prevents ENOENT crashes caused by the Claude Agent SDK writing debug/trace
 * files to `~/.claude/debug/<uuid>.txt`. In serverless runtimes the home
 * directory (e.g. `/home/sbx_user1051/`) is **read-only**, so any write to
 * `~/.claude/` fails with:
 *
 *   Error: ENOENT: no such file or directory, open
 *     '/home/sbx_user1051/.claude/debug/b2ec0fba-….txt'
 *
 * ─── Strategy (two-layer defence) ─────────────────────────────────────────
 *
 * 1. **Environment redirect (primary)**
 *    Set `CLAUDE_CONFIG_DIR=/tmp/.claude` in the *current* process env so the
 *    SDK's config-dir resolver (`process.env.CLAUDE_CONFIG_DIR ?? join(homedir(),
 *    '.claude')`) picks `/tmp/.claude` instead of the read-only home directory.
 *    Pre-create `/tmp/.claude/debug/` to avoid ENOENT on first write.
 *
 * 2. **`fs` monkey-patch (safety net)**
 *    Intercept `fs.writeFileSync`, `fs.appendFileSync` and `fs.mkdirSync` for
 *    any absolute path containing `/.claude/` that is NOT already under `/tmp/`
 *    or the project working directory: redirect those operations to
 *    `/tmp/.claude/…`. If even the redirected write fails, swallow the error
 *    silently — debug/trace logs are non-critical.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────
 *
 *   // Import as side-effect BEFORE the SDK import:
 *   import "@/core/platform/serverless-fs-patch";
 *   import { query } from "@anthropic-ai/claude-agent-sdk";
 *
 * The patch is idempotent and no-ops outside serverless environments.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Writable base directory available in serverless runtimes. */
const REDIRECT_BASE = "/tmp";

/** Target config directory under /tmp (always use forward slashes for serverless runtimes). */
const REDIRECT_CLAUDE_DIR = `${REDIRECT_BASE}/.claude`;

/** In-memory fallback store: path → content buffer (used when /tmp writes fail) */
const memoryStore = new Map<string, Buffer>();

/** Whether the patch has been applied. */
let installed = false;

// ─── Guards ──────────────────────────────────────────────────────────────────

/**
 * Returns `true` when running inside a serverless environment
 * (Vercel Lambda, AWS Lambda, Netlify Functions, GCP Cloud Functions).
 */
function isServerlessRuntime(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.FUNCTION_NAME
  );
}

/**
 * Decide whether `filePath` should be redirected to `/tmp/.claude/…`.
 *
 * Criteria – ALL must be true:
 *   1. `filePath` is a string containing `/.claude/`
 *   2. It is NOT already under `/tmp/`
 *   3. It is NOT under the project working directory (`process.cwd()`)
 *      — project-local `.claude/skills/` etc. should work normally.
/**
 * Normalize a file path to use forward slashes for cross-platform comparison.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function shouldRedirect(filePath: unknown): filePath is string {
  if (typeof filePath !== "string") return false;
  // Normalize path separators for cross-platform comparison
  const normalized = normalizePath(filePath);
  if (!normalized.includes("/.claude/")) return false;
  if (normalized.startsWith(REDIRECT_BASE + "/")) return false;

  // Don't redirect project-local .claude paths (e.g. .claude/skills/)
  try {
    const cwd = normalizePath(process.cwd());
    if (normalized.startsWith(cwd + "/")) {
      return false;
    }
  } catch {
    // process.cwd() can throw in edge cases — continue with redirect
  }
  return true;
}

/**
 * Rewrite an absolute path by replacing everything up to (and including)
 * `/.claude/` with `/tmp/.claude/`.
 *
 * Example:
 *   `/home/sbx_user1051/.claude/debug/uuid.txt`
 *   → `/tmp/.claude/debug/uuid.txt`
 */
export function rewritePath(filePath: string): string {
  const marker = "/.claude/";
  const normalized = normalizePath(filePath);
  const idx = normalized.indexOf(marker);
  if (idx === -1) return filePath;
  // Keep everything after "/.claude/" and prepend /tmp/.claude/
  // Always use forward slashes since serverless runtimes are Unix-based
  return REDIRECT_CLAUDE_DIR + "/" + normalized.substring(idx + marker.length);
}

// ─── Directory helpers ───────────────────────────────────────────────────────

// Cache the *original* fs functions so our helpers never trigger infinite
// recursion through the monkey-patched versions.
const _originalMkdirSync = fs.mkdirSync;
const _originalWriteFileSync = fs.writeFileSync;
const _originalAppendFileSync = fs.appendFileSync;
const _originalExistsSync = fs.existsSync;

function ensureDirectory(dirPath: string): void {
  try {
    _originalMkdirSync(dirPath, { recursive: true });
  } catch {
    // Already exists or genuinely cannot be created — either way, continue.
  }
}

// ─── In-memory fallback ─────────────────────────────────────────────────────

function memoryAppend(filePath: string, data: string | Uint8Array): void {
  const existing = memoryStore.get(filePath) ?? Buffer.alloc(0);
  const incoming = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
  memoryStore.set(filePath, Buffer.concat([existing, incoming]));
}

function memoryWrite(filePath: string, data: string | NodeJS.ArrayBufferView): void {
  const incoming =
    typeof data === "string"
      ? Buffer.from(data, "utf-8")
      : Buffer.from(data as unknown as Uint8Array);
  memoryStore.set(filePath, incoming);
}

// ─── Core patch installer ────────────────────────────────────────────────────

/**
 * Safely monkey-patch a property on the `fs` module.
 *
 * Node.js ESM exports are non-configurable by default. We try direct
 * assignment first, then `Object.defineProperty`, then give up silently.
 */
function patchFsMethod(name: string, fn: (...args: unknown[]) => unknown): void {
  try {
    // Try making it configurable + writable first
    Object.defineProperty(fs, name, {
      value: fn,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    try {
      // Fallback: direct assignment (works in CJS)
      (fs as Record<string, unknown>)[name] = fn;
    } catch {
      // Cannot patch — env-var redirect (Layer 1) is still in effect.
      console.warn(
        `[ServerlessFsPatch] Could not patch fs.${name} — relying on CLAUDE_CONFIG_DIR env redirect`,
      );
    }
  }
}

/**
 * Install the serverless filesystem patch.
 *
 * Idempotent — safe to call multiple times. No-ops outside serverless
 * environments.
 */
export function installServerlessFsPatch(): boolean {
  if (installed) return true;
  if (!isServerlessRuntime()) return false;

  installed = true;

  // ── Layer 1: Environment redirect ──────────────────────────────────────
  if (!process.env.CLAUDE_CONFIG_DIR) {
    process.env.CLAUDE_CONFIG_DIR = REDIRECT_CLAUDE_DIR;
  }

  // Pre-create the debug directory so the first write succeeds.
  ensureDirectory(path.join(REDIRECT_CLAUDE_DIR, "debug"));

  // ── Layer 2: fs monkey-patch ───────────────────────────────────────────

  // -- appendFileSync --
  const origAppend = _originalAppendFileSync;
  patchFsMethod(
    "appendFileSync",
    function patchedAppendFileSync(...args: unknown[]): void {
      const p = args[0] as fs.PathOrFileDescriptor;
      const data = args[1] as string | Uint8Array;
      const options = args[2] as fs.WriteFileOptions | undefined;
      if (shouldRedirect(p)) {
        const newPath = rewritePath(p);
        ensureDirectory(path.dirname(newPath));
        try {
          return origAppend.call(fs, newPath, data, options);
        } catch {
          // /tmp write also failed → fall back to memory store (non-critical data)
          memoryAppend(newPath, data);
          return;
        }
      }
      return origAppend.call(fs, p, data, options);
    },
  );

  // -- writeFileSync --
  const origWrite = _originalWriteFileSync;
  patchFsMethod(
    "writeFileSync",
    function patchedWriteFileSync(...args: unknown[]): void {
      const p = args[0] as fs.PathOrFileDescriptor;
      const data = args[1] as string | NodeJS.ArrayBufferView;
      const options = args[2] as fs.WriteFileOptions | undefined;
      if (shouldRedirect(p)) {
        const newPath = rewritePath(p);
        ensureDirectory(path.dirname(newPath));
        try {
          return origWrite.call(fs, newPath, data, options);
        } catch {
          memoryWrite(newPath, data);
          return;
        }
      }
      return origWrite.call(fs, p, data, options);
    },
  );

  // -- mkdirSync --
  const origMkdir = _originalMkdirSync;
  patchFsMethod(
    "mkdirSync",
    function patchedMkdirSync(...args: unknown[]): string | undefined {
      const p = args[0] as fs.PathLike;
      const options = args[1] as (fs.MakeDirectoryOptions & { recursive?: boolean }) | undefined;
      if (typeof p === "string" && shouldRedirect(p)) {
        const newPath = rewritePath(p);
        try {
          return origMkdir.call(fs, newPath, options) as string | undefined;
        } catch {
          return undefined;
        }
      }
      return origMkdir.call(fs, p, options) as string | undefined;
    },
  );

  // -- existsSync (so the SDK can probe for files it previously wrote) --
  const origExists = _originalExistsSync;
  patchFsMethod(
    "existsSync",
    function patchedExistsSync(...args: unknown[]): boolean {
      const p = args[0] as fs.PathLike;
      if (typeof p === "string" && shouldRedirect(p)) {
        const newPath = rewritePath(p);
        return origExists.call(fs, newPath) || memoryStore.has(newPath);
      }
      return origExists.call(fs, p);
    },
  );

  console.log(
    "[ServerlessFsPatch] Installed — .claude/ writes redirected to /tmp/.claude/",
  );
  return true;
}

/**
 * Check whether the patch is currently active.
 */
export function isServerlessFsPatchInstalled(): boolean {
  return installed;
}

/**
 * Retrieve a file from the in-memory fallback store (for testing/debugging).
 */
export function getMemoryStoreEntry(filePath: string): Buffer | undefined {
  return memoryStore.get(filePath);
}

/**
 * Clear the in-memory store (useful in tests).
 */
export function clearMemoryStore(): void {
  memoryStore.clear();
}

/**
 * Reset the patch state (for testing only — does NOT un-patch `fs`).
 */
export function _resetForTesting(): void {
  installed = false;
  memoryStore.clear();
}

// ─── Auto-install on import ──────────────────────────────────────────────────
installServerlessFsPatch();
