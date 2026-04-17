import { describe, expect, it } from "vitest";

import { buildGroupedApiItems, splitApiRouteSegments, splitBrowserRouteSegments } from "../surface-navigation";

describe("surface-navigation helpers", () => {
  it("groups api methods by shared path", () => {
    const items = buildGroupedApiItems({
      kind: "nextjs-api",
      apis: [
        {
          method: "GET",
          path: "/api/feature-explorer",
          sourceFiles: ["src/app/api/feature-explorer/route.ts"],
        },
        {
          method: "POST",
          path: "/api/feature-explorer",
          sourceFiles: ["src/app/api/feature-explorer/route.ts"],
        },
      ],
      query: "",
      resolveFeatureIds: () => ["feature-explorer"],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("/api/feature-explorer");
    expect(items[0]?.badges).toEqual(["GET", "POST"]);
    expect(items[0]?.featureIds).toEqual(["feature-explorer"]);
  });

  it("preserves leading slash for top-level route groups", () => {
    expect(splitBrowserRouteSegments("/workspace/:workspaceId/feature-explorer")).toEqual([
      "/workspace",
      ":workspaceId",
      "feature-explorer",
    ]);
    expect(splitApiRouteSegments("/api/feature-explorer")).toEqual([
      "/feature-explorer",
    ]);
  });
});
