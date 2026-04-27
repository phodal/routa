import {
  CANVAS_SDK_MANIFEST_RESOURCE_URI,
  getCanvasSdkResourceManifest,
} from "./sdk-resource-contract";

export { getCanvasSdkManifest } from "./sdk-resource-contract";

export function buildCanvasSdkPromptSection(): string {
  const manifest = getCanvasSdkResourceManifest();
  const preferredUris = [
    "resource://routa/canvas-sdk/defs/primitives",
    "resource://routa/canvas-sdk/defs/hooks",
    "resource://routa/canvas-sdk/defs/data-display",
    "resource://routa/canvas-sdk/defs/containers",
    "resource://routa/canvas-sdk/defs/controls",
    "resource://routa/canvas-sdk/defs/charts",
    "resource://routa/canvas-sdk/defs/diff-view",
    "resource://routa/canvas-sdk/defs/dag-layout",
  ];
  const definitionUris = preferredUris
    .filter((uri) => manifest.definitionResources.some((entry) => entry.resourceUri === uri))
    .map((uri) => `- ${uri}`);

  return [
    "Canvas SDK access:",
    `- Prefer MCP tool \`read_canvas_sdk_resource\` with uri \`${CANVAS_SDK_MANIFEST_RESOURCE_URI}\`.`,
    "- If your provider supports native MCP resource reads, you may read that same URI directly instead.",
    "- That manifest is the authoritative Canvas SDK index for this session.",
    "- Then read only the defs resources you actually need from its `definitionResources` list, preferably through `read_canvas_sdk_resource`.",
    `- Import only from \`${manifest.moduleSpecifier}\` or \`react\`.`,
    "- If a symbol or prop is not present in those resources, do not invent it.",
    "- Example definition resources:",
    ...definitionUris,
    "- If neither direct resource reads nor the helper tool are available, stay conservative and use only the symbols named in the manifest.",
  ].join("\n");
}
