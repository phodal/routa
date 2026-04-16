/**
 * /api/workspaces/[workspaceId]/codebases/[codebaseId] - Workspace-scoped codebase operations.
 *
 * DELETE /api/workspaces/:workspaceId/codebases/:codebaseId → Remove codebase from workspace
 */

import { deleteCodebaseById } from "@/app/api/codebases/delete-codebase";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> }
) {
  const { workspaceId, codebaseId } = await params;
  return deleteCodebaseById(codebaseId, workspaceId);
}
