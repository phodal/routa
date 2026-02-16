/**
 * ACP Utility functions
 *
 * Uses the platform bridge for process execution and file system access.
 */

import { getServerBridge } from "@/core/platform";

/**
 * Find an executable in PATH or node_modules/.bin.
 * Returns the resolved path if found, null otherwise.
 *
 * Checks in this order:
 * 1. Absolute path (if provided)
 * 2. node_modules/.bin (for locally installed packages)
 * 3. System PATH (using bridge.process.which)
 */
export async function which(command: string): Promise<string | null> {
  const path = await import("path");
  const bridge = getServerBridge();

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
    const localBinPath = path.join(bridge.env.currentDir(), "node_modules", ".bin", command);
    if (bridge.fs.existsSync(localBinPath)) {
      const stat = bridge.fs.statSync(localBinPath);
      if (stat.isFile) return localBinPath;
    }
  } catch {
    // Ignore errors, continue to PATH check
  }

  // 3. Check system PATH using bridge.process.which
  return bridge.process.which(command);
}
