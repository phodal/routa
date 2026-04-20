import { describe, expect, it } from "vitest";

import {
  buildGroupedApiItems,
  buildSurfaceTree,
  getHttpMethodBadgeClass,
  splitApiRouteSegments,
  splitBrowserRouteSegments,
} from "../surface-navigation";

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

  it("merges shared route prefixes into one tree branch", () => {
    const nodes = buildSurfaceTree([
      {
        nodeId: "page:/settings",
        segments: splitBrowserRouteSegments("/settings"),
        item: {
          key: "page:/settings",
          kind: "page",
          label: "/settings",
          secondary: "",
          featureIds: [],
          sourceFiles: [],
          selectable: true,
        },
      },
      {
        nodeId: "page:/settings/agents",
        segments: splitBrowserRouteSegments("/settings/agents"),
        item: {
          key: "page:/settings/agents",
          kind: "page",
          label: "/settings/agents",
          secondary: "",
          featureIds: [],
          sourceFiles: [],
          selectable: true,
        },
      },
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.label).toBe("/settings");
    expect(nodes[0]?.item?.key).toBe("page:/settings");
    expect(nodes[0]?.children).toHaveLength(1);
    expect(nodes[0]?.children[0]?.label).toBe("agents");
    expect(nodes[0]?.itemCount).toBe(2);
  });

  it("assigns distinct badge tones to different http methods", () => {
    expect(getHttpMethodBadgeClass("GET", "compact")).toContain("emerald");
    expect(getHttpMethodBadgeClass("POST", "compact")).toContain("sky");
    expect(getHttpMethodBadgeClass("PATCH", "compact")).toContain("amber");
    expect(getHttpMethodBadgeClass("DELETE", "compact")).toContain("rose");
  });
});
