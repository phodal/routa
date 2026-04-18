/**
 * Workspace / Team - /workspace/:workspaceId/team
 * Workspace-scoped team run index for multi-agent collaboration and coordination history.
 */
import { TeamPageClient } from "./team-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceTeamPage() {
  return <TeamPageClient />;
}
