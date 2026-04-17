import {
  CANVAS_SDK_MANIFEST_RESOURCE_URI,
  getCanvasSdkResourceManifest,
} from "./sdk-resource-contract";

export { getCanvasSdkManifest } from "./sdk-resource-contract";

export function buildCanvasSdkPromptSection(): string {
  const manifest = getCanvasSdkResourceManifest();
  const preferredUris = [
    "resource://routa/canvas-sdk/defs/primitives",
    "resource://routa/canvas-sdk/defs/data-display",
    "resource://routa/canvas-sdk/defs/containers",
    "resource://routa/canvas-sdk/defs/charts",
  ];
  const definitionUris = preferredUris
    .filter((uri) => manifest.definitionResources.some((entry) => entry.resourceUri === uri))
    .map((uri) => `- ${uri}`);

  return [
    "Canvas SDK access:",
    `- First read MCP resource \`${CANVAS_SDK_MANIFEST_RESOURCE_URI}\`.`,
    "- That manifest is the authoritative Canvas SDK index for this session.",
    "- Then read only the defs resources you actually need from its `definitionResources` list.",
    `- Import only from \`${manifest.moduleSpecifier}\` or \`react\`.`,
    "- If a symbol or prop is not present in those resources, do not invent it.",
    "- Example definition resources:",
    ...definitionUris,
    "- If MCP resource access is unavailable, stay conservative and use only the symbols named in the manifest.",
  ].join("\n");
}
