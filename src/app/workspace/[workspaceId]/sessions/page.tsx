/**
 * Workspace / Sessions - /workspace/:workspaceId/sessions
 * Workspace-scoped session index for browsing, filtering, and opening agent execution history.
 */
import { SessionsPageClient } from "./sessions-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceSessionsPage() {
  return <SessionsPageClient />;
}
