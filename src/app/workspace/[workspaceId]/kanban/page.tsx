/**
 * Workspace / Kanban - /workspace/:workspaceId/kanban
 * Main kanban board for workspace-scoped task coordination, lane automation, and git-aware task execution.
 */
import { KanbanPageClient } from "./kanban-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceKanbanPage() {
  return <KanbanPageClient />;
}
