import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CANVAS_SDK_MANIFEST_RESOURCE_URI } from "@/core/canvas/sdk-resource-contract";
import { registerCanvasSdkResources } from "../canvas-sdk-resources";

function getTextContent(
  content:
    | { uri: string; text: string; mimeType?: string; _meta?: Record<string, unknown> }
    | { uri: string; blob: string; mimeType?: string; _meta?: Record<string, unknown> }
    | undefined,
): string {
  return content && "text" in content ? content.text : "";
}

describe("canvas sdk mcp resources", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const callback = cleanup.pop();
      if (callback) {
        await callback();
      }
    }
  });

  it("lists and reads registered canvas sdk resources", async () => {
    const server = new McpServer({ name: "test-canvas-sdk", version: "0.1.0" });
    registerCanvasSdkResources(server);

    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const resources = await client.listResources();
    expect(resources.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uri: CANVAS_SDK_MANIFEST_RESOURCE_URI }),
        expect.objectContaining({ uri: "resource://routa/canvas-sdk/defs/primitives" }),
      ]),
    );

    const manifest = await client.readResource({ uri: CANVAS_SDK_MANIFEST_RESOURCE_URI });
    const manifestText = getTextContent(manifest.contents[0]);
    expect(manifestText).toContain('"moduleSpecifier": "@canvas-sdk"');
    expect(manifestText).toContain('"resource://routa/canvas-sdk/defs/primitives"');

    const primitives = await client.readResource({ uri: "resource://routa/canvas-sdk/defs/primitives" });
    const primitivesText = getTextContent(primitives.contents[0]);
    expect(primitivesText).toContain("export type StackProps");
    expect(primitivesText).toContain("export declare function Stack");
  });
});
