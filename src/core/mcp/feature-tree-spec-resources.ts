import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI,
  getFeatureTreeSpecManifest,
  readFeatureTreeSpecResource,
} from "@/core/spec/feature-tree-spec-resource-contract";

export function registerFeatureTreeSpecResources(server: McpServer): void {
  server.registerResource(
    "feature-tree-spec-manifest",
    FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI,
    {
      title: "Feature Tree Framework Spec Manifest",
      description: "Manifest for framework-specific feature-tree overlay specs.",
      mimeType: "application/json",
    },
    async () => {
      const resource = readFeatureTreeSpecResource(FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI);
      if (!resource) {
        throw new Error(`Unknown feature-tree spec resource: ${FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI}`);
      }
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        ],
      };
    },
  );

  for (const spec of getFeatureTreeSpecManifest().specs) {
    server.registerResource(
      `feature-tree-spec-${spec.id}`,
      spec.resourceUri,
      {
        title: `Feature Tree Framework Spec: ${spec.title}`,
        description: spec.description,
        mimeType: "text/markdown",
      },
      async () => {
        const resource = readFeatureTreeSpecResource(spec.resourceUri);
        if (!resource) {
          throw new Error(`Unknown feature-tree spec resource: ${spec.resourceUri}`);
        }
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text: resource.text,
            },
          ],
        };
      },
    );
  }
}
