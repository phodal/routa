/**
 * Folder Slug — Unified path-to-slug algorithm for local storage.
 *
 * Converts absolute paths to slug format for use as directory names
 * under ~/.routa/projects/{folder-slug}/.
 *
 * Algorithm:
 * 1. Strip leading path separators (/ or \)
 * 2. Replace all path separators with hyphens
 * 3. Collapse consecutive separators into a single hyphen
 *
 * Examples:
 *   /Users/john/my-project → Users-john-my-project
 *   C:\Users\john\project  → C-Users-john-project
 *
 * The same algorithm is implemented in Rust (routa-core) for consistency.
 */

/**
 * Convert an absolute path to a folder slug.
 *
 * @param absolutePath - The absolute path to convert
 * @returns The folder slug (e.g., "Users-john-my-project")
 */
export function toFolderSlug(absolutePath: string): string {
  // Strip leading separators
  let cleaned = absolutePath.replace(/^[/\\]+/, "");
  // Strip trailing separators (avoids trailing hyphen in slug)
  cleaned = cleaned.replace(/[/\\]+$/, "");
  // Windows: strip drive colons so slug is a valid directory name (E:\foo -> E-foo, not E:-foo)
  cleaned = cleaned.replace(/:/g, "");
  // Replace all path separators (including consecutive) with a single hyphen
  cleaned = cleaned.replace(/[/\\]+/g, "-");
  return cleaned;
}

/**
 * Get the base storage directory for a project.
 *
 * @param absolutePath - The project's absolute path
 * @returns Path like ~/.routa/projects/{folder-slug}
 */
export function getProjectStorageDir(absolutePath: string): string {
  const slug = toFolderSlug(absolutePath);
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  return `${homeDir}/.routa/projects/${slug}`;
}

/**
 * Get the sessions directory for a project.
 *
 * @param absolutePath - The project's absolute path
 * @returns Path like ~/.routa/projects/{folder-slug}/sessions
 */
export function getSessionsDir(absolutePath: string): string {
  return `${getProjectStorageDir(absolutePath)}/sessions`;
}

/**
 * Get the traces directory for a project.
 *
 * @param absolutePath - The project's absolute path
 * @returns Path like ~/.routa/projects/{folder-slug}/traces
 */
export function getTracesDir(absolutePath: string): string {
  return `${getProjectStorageDir(absolutePath)}/traces`;
}

/**
 * Get the tool calls context directory for a specific session.
 *
 * @param absolutePath - The project's absolute path
 * @param sessionId - The session ID
 * @returns Path like ~/.routa/projects/{folder-slug}/sessions/{sessionId}/tool-calls
 */
export function getToolCallsDir(absolutePath: string, sessionId: string): string {
  return `${getSessionsDir(absolutePath)}/${sessionId}/tool-calls`;
}
