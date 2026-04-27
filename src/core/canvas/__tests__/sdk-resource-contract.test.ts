import { describe, expect, it } from "vitest";

import {
  CANVAS_SDK_MANIFEST_RESOURCE_URI,
  getCanvasSdkDefinitionResourceUri,
  getCanvasSdkResourceManifest,
} from "../sdk-resource-contract";

describe("canvas sdk resource contract", () => {
  it("builds stable resource uris for generated definition files", () => {
    expect(getCanvasSdkDefinitionResourceUri("resources/canvas/sdk/primitives.d.ts")).toBe(
      "resource://routa/canvas-sdk/defs/primitives",
    );
  });

  it("exposes a compact manifest with definition resource uris", () => {
    const manifest = getCanvasSdkResourceManifest();

    expect(CANVAS_SDK_MANIFEST_RESOURCE_URI).toBe("resource://routa/canvas-sdk/manifest");
    expect(manifest.moduleSpecifier).toBe("routa/canvas");
    expect(manifest.definitionResources).toContainEqual({
      filePath: "resources/canvas/sdk/primitives.d.ts",
      resourceUri: "resource://routa/canvas-sdk/defs/primitives",
    });

    expect(manifest.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Primitives (layout + typography)",
          definitionResourceUri: "resource://routa/canvas-sdk/defs/primitives",
        }),
      ]),
    );
  });
});
