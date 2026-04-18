/**
 * Workspace / Spec - /workspace/default/spec
 * Dense issue relationship board for local docs/issues records.
 * Highlights issue families, linked product surfaces, and escalation paths.
 */
import { SpecPageClient } from "./spec-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceSpecPage() {
  return <SpecPageClient />;
}
