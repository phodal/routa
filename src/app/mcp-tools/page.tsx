/**
 * Mcp Tools - /mcp-tools
 * Shortcut route that redirects to the MCP tools settings experience for browsing and executing configured tools.
 */
import { redirect } from "next/navigation";

export default function McpToolsPage() {
  redirect("/settings/mcp?tab=tools");
}
