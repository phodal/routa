/**
 * Settings / Fitness - /settings/fitness
 * Compatibility route that forwards fitness configuration requests to the fluency settings surface with preserved repository context.
 */
import { redirect } from "next/navigation";

type SearchParams = {
  workspaceId?: string | string[];
  codebaseId?: string | string[];
  repoPath?: string | string[];
};

export default function FitnessSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = new URLSearchParams();
  const workspaceId = Array.isArray(searchParams.workspaceId)
    ? searchParams.workspaceId[0]
    : searchParams.workspaceId;
  const codebaseId = Array.isArray(searchParams.codebaseId)
    ? searchParams.codebaseId[0]
    : searchParams.codebaseId;
  const repoPath = Array.isArray(searchParams.repoPath)
    ? searchParams.repoPath[0]
    : searchParams.repoPath;

  if (workspaceId) query.set("workspaceId", workspaceId);
  if (codebaseId) query.set("codebaseId", codebaseId);
  if (repoPath) query.set("repoPath", repoPath);

  const suffix = query.toString();
  redirect(suffix ? `/settings/fluency?${suffix}` : "/settings/fluency");
}
