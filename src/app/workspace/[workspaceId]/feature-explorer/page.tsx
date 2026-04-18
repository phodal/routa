import { FeatureExplorerPageClient } from "./feature-explorer-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default async function FeatureExplorerPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <FeatureExplorerPageClient workspaceId={workspaceId} />;
}
