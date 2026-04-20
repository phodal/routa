/**
 * Workspace / Overview - /workspace/:workspaceId/overview
 * Workspace entry route that currently redirects to the sessions surface while preserving workspace scope.
 */
import { redirect } from "next/navigation";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default async function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(`/workspace/${workspaceId}/sessions`);
}
