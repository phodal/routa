/**
 * ACP Utility functions
 *
 * Uses the platform bridge for process execution and file system access.
 */

import { getServerBridge } from "@/core/platform";

const WINDOWS_SPAWNABLE_EXTENSIONS = [".cmd", ".bat", ".exe", ".com"];

function getCandidateDirectory(candidate: string): string {
  const normalized = candidate.trim().replace(/[\\/]+$/, "");
  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSeparator < 0) return "";
  return normalized.slice(0, lastSeparator).toLowerCase();
}

/**
 * Whether a command path requires the shell to be invoked (Windows only).
 *
 * On Windows, batch files (`.cmd`, `.bat`) cannot be spawned directly by
 * Node.js's `child_process.spawn` — they must be executed through `cmd.exe`.
 * Passing `shell: true` to `spawn()` handles this transparently.
 */
export function needsShell(command: string): boolean {
  const lower = command.toLowerCase();

  // Explicit .cmd/.bat extension
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return true;
  }

  // On Windows, npm-installed CLI tools without extensions might be .cmd files
  // We need shell to properly resolve and execute them
  if (process.platform === "win32") {
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(command);
    const isPath = command.includes("/") || command.includes("\\");
    if (!hasExtension && !isPath) {
      return true;
    }
  }

  return false;
}

/**
 * Quote Windows wrapper paths before handing them to `spawn(..., { shell: true })`.
 *
 * Without the extra quotes, cmd.exe treats special characters as operators:
 * - `C:\Program Files\nodejs\npx.cmd` splits at the space
 * - `C:\Users\R&D\AppData\npx.cmd` treats `&` as a command separator
 * - `C:\Program Files (x86)\Tool\script.cmd` treats `(` and `)` as grouping operators
 * - Other special chars: `^`, `|`, `<`, `>`, `%`
 *
 * This function quotes all shell wrapper paths (`.cmd`, `.bat`) to handle all
 * Windows shell special characters, not just whitespace.
 */
export function quoteShellCommandPath(command: string): string {
  // Only quote paths that need shell execution (.cmd, .bat files)
  if (!needsShell(command)) {
    return command;
  }

  // Already quoted - don't double-quote
  if (command.startsWith('"') && command.endsWith('"')) {
    return command;
  }

  // Quote all shell wrapper paths to handle all special characters
  return `"${command}"`;
}

function preferSpawnableWindowsPath(candidates: string[]): string | null {
  const normalized = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  const firstCandidate = normalized[0];
  if (!firstCandidate) return null;

  const firstDirectory = getCandidateDirectory(firstCandidate);
  const sameDirectoryCandidates = normalized.filter(
    (candidate) => getCandidateDirectory(candidate) === firstDirectory
  );

  for (const ext of WINDOWS_SPAWNABLE_EXTENSIONS) {
    const match = sameDirectoryCandidates.find((candidate) =>
      candidate.toLowerCase().endsWith(ext)
    );
    if (match) return match;
  }

  return firstCandidate;
}

/**
 * Find an executable in PATH or node_modules/.bin.
 * Returns the resolved path if found, null otherwise.
 *
 * Checks in this order:
 * 1. Absolute path (if provided)
 * 2. node_modules/.bin (for locally installed packages)
 * 3. System PATH (using bridge.process.which)
 *
 * On Windows, npm creates a bash wrapper (no extension) alongside a `.cmd`
 * batch file in node_modules/.bin. We prefer the `.cmd` version because
 * the extensionless wrapper cannot be spawned directly by Node.js on Windows.
 */
export async function which(command: string): Promise<string | null> {
  const path = await import("path");
  const bridge = getServerBridge();
  const isWindows = bridge.env.osPlatform() === "win32";

  // 1. If command is already an absolute path, check if it exists
  if (command.startsWith("/") || command.startsWith("\\") || path.isAbsolute(command)) {
    try {
      const stat = bridge.fs.statSync(command);
      if (stat.isFile) return command;
    } catch {
      return null;
    }
  }

  // 2. Check node_modules/.bin (for locally installed packages)
  try {
    const localBinBase = path.join(bridge.env.currentDir(), "node_modules", ".bin", command);
    if (isWindows) {
      // On Windows prefer the .cmd batch file — the extensionless file is a
      // bash wrapper that cannot be spawned directly by Node.js on Windows.
      const cmdPath = localBinBase + ".cmd";
      if (bridge.fs.existsSync(cmdPath)) {
        const stat = bridge.fs.statSync(cmdPath);
        if (stat.isFile) return cmdPath;
      }
    } else {
      if (bridge.fs.existsSync(localBinBase)) {
        const stat = bridge.fs.statSync(localBinBase);
        if (stat.isFile) return localBinBase;
      }
    }
  } catch {
    // Ignore errors, continue to PATH check
  }

  // 3. Check system PATH using bridge.process.which
  const resolved = await bridge.process.which(command);
  if (!resolved) return null;

  if (!isWindows) {
    return resolved;
  }

  return preferSpawnableWindowsPath(resolved.split(/\r?\n/));
}
