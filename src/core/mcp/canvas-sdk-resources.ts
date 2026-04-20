import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  CANVAS_SDK_MANIFEST_RESOURCE_URI,
  getCanvasSdkDefinitionResourceUri,
  getCanvasSdkManifest,
  readCanvasSdkResource,
} from "@/core/canvas/sdk-resource-contract";

export function registerCanvasSdkResources(server: McpServer): void {
  const sdkManifest = getCanvasSdkManifest();

  server.registerResource(
    "canvas-sdk-manifest",
    CANVAS_SDK_MANIFEST_RESOURCE_URI,
    {
      title: "Canvas SDK Manifest",
      description: "Compact Canvas SDK manifest for specialist UI generation.",
      mimeType: "application/json",
    },
    async () => {
      const resource = readCanvasSdkResource(CANVAS_SDK_MANIFEST_RESOURCE_URI);
      if (!resource) {
        throw new Error(`Unknown Canvas SDK resource: ${CANVAS_SDK_MANIFEST_RESOURCE_URI}`);
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

  for (const definitionFile of sdkManifest.definitionFiles) {
    const resourceUri = getCanvasSdkDefinitionResourceUri(definitionFile.path);

    server.registerResource(
      `canvas-sdk-def-${resourceUri.split("/").at(-1) ?? "unknown"}`,
      resourceUri,
      {
        title: `Canvas SDK Definition: ${definitionFile.path}`,
        description: `Generated TypeScript definition for ${definitionFile.path}.`,
        mimeType: "text/plain",
      },
      async () => {
        const resource = readCanvasSdkResource(resourceUri);
        if (!resource) {
          throw new Error(`Unknown Canvas SDK resource: ${resourceUri}`);
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
