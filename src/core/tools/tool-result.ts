/**
 * ToolResult - port of routa-core ToolResult.kt
 *
 * Standard result type for all agent coordination tools.
 */

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export function successResult(data: unknown): ToolResult {
  return { success: true, data };
}

export function errorResult(error: string): ToolResult {
  return { success: false, error };
}
