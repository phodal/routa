/**
 * ACP Utility functions
 */

import { execFile } from "child_process";

/**
 * Find an executable in PATH or node_modules/.bin.
 * Returns the resolved path if found, null otherwise.
 *
 * Checks in this order:
 * 1. Absolute path (if provided)
 * 2. node_modules/.bin (for locally installed packages)
 * 3. System PATH (using which/where command)
 */
export async function which(command: string): Promise<string | null> {
  const path = await import("path");
  const fs = await import("fs");

  // 1. If command is already an absolute path, check if it exists
  if (command.startsWith("/") || command.startsWith("\\") || path.isAbsolute(command)) {
    try {
      const stat = fs.statSync(command);
      if (stat.isFile()) return command;
    } catch {
      return null;
    }
  }

  // 2. Check node_modules/.bin (for locally installed packages)
  try {
    const localBinPath = path.join(process.cwd(), "node_modules", ".bin", command);
    if (fs.existsSync(localBinPath)) {
      const stat = fs.statSync(localBinPath);
      if (stat.isFile()) return localBinPath;
    }
  } catch {
    // Ignore errors, continue to PATH check
  }

  // 3. Check system PATH using which/where command
  const isWindows = process.platform === "win32";
  const checkCmd = isWindows ? "where" : "which";

  return new Promise((resolve) => {
    execFile(checkCmd, [command], (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null);
      } else {
        // On Windows, `where` may return multiple lines; take the first
        resolve(stdout.trim().split("\n")[0].trim());
      }
    });
  });
}
