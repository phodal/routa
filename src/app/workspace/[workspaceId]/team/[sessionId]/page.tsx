import { TeamRunPageClient } from "./team-run-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__", sessionId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceTeamRunPage() {
  return <TeamRunPageClient />;
}
