import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  CANVAS_SDK_MANIFEST_RESOURCE_URI,
  getCanvasSdkDefinitionResourceUri,
  getCanvasSdkManifest,
  getCanvasSdkResourceManifest,
} from "@/core/canvas/sdk-resource-contract";

export function registerCanvasSdkResources(server: McpServer): void {
  const sdkManifest = getCanvasSdkManifest();
  const resourceManifest = getCanvasSdkResourceManifest();

  server.registerResource(
    "canvas-sdk-manifest",
    CANVAS_SDK_MANIFEST_RESOURCE_URI,
    {
      title: "Canvas SDK Manifest",
      description: "Compact Canvas SDK manifest for specialist UI generation.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: CANVAS_SDK_MANIFEST_RESOURCE_URI,
          mimeType: "application/json",
          text: `${JSON.stringify(resourceManifest, null, 2)}\n`,
        },
      ],
    }),
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
      async () => ({
        contents: [
          {
            uri: resourceUri,
            mimeType: "text/plain",
            text: definitionFile.source,
          },
        ],
      }),
    );
  }
}
