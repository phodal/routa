import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI } from "@/core/spec/feature-tree-spec-resource-contract";
import { registerFeatureTreeSpecResources } from "../feature-tree-spec-resources";

function getTextContent(
  content:
    | { uri: string; text: string; mimeType?: string; _meta?: Record<string, unknown> }
    | { uri: string; blob: string; mimeType?: string; _meta?: Record<string, unknown> }
    | undefined,
): string {
  return content && "text" in content ? content.text : "";
}

describe("feature-tree specialist mcp resources", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const callback = cleanup.pop();
      if (callback) {
        await callback();
      }
    }
  });

  it("lists and reads registered feature-tree framework specs", async () => {
    const server = new McpServer({ name: "test-feature-tree-specs", version: "0.1.0" });
    registerFeatureTreeSpecResources(server);

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
        expect.objectContaining({ uri: FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI }),
        expect.objectContaining({ uri: "resource://routa/specialists/feature-tree/specs/nextjs" }),
        expect.objectContaining({ uri: "resource://routa/specialists/feature-tree/specs/axum" }),
      ]),
    );

    const manifest = await client.readResource({ uri: FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI });
    const manifestText = getTextContent(manifest.contents[0]);
    expect(manifestText).toContain('"baseRulesInPrompt": true');
    expect(manifestText).toContain('"resource://routa/specialists/feature-tree/specs/gin"');

    const axumSpec = await client.readResource({
      uri: "resource://routa/specialists/feature-tree/specs/axum",
    });
    const axumText = getTextContent(axumSpec.contents[0]);
    expect(axumText).toContain("# Axum Feature Surface Overlay");
    expect(axumText).toContain("Router::new()");
  });
});
