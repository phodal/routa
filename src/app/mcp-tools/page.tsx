import { redirect } from "next/navigation";

export default function McpToolsPage() {
  redirect("/settings/mcp?tab=tools");
}
