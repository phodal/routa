import path from "path";

import sdkManifestJson from "../../../resources/canvas/canvas-sdk-manifest.json";

export type CanvasSdkExportSymbol = {
  name: string;
  kind: "type" | "value";
};

export type CanvasSdkExportGroup = {
  title: string;
  source: string | null;
  symbols: CanvasSdkExportSymbol[];
};

export type CanvasSdkDefinitionFile = {
  path: string;
  source: string;
};

export type CanvasSdkManifest = {
  generatedAt: string;
  moduleSpecifier: string;
  sourceBarrel: string;
  definitionsDir: string;
  indexDefinitionPath: string;
  importExamples: string[];
  promptRules: string[];
  groups: CanvasSdkExportGroup[];
  allExports: CanvasSdkExportSymbol[];
  definitionFiles: CanvasSdkDefinitionFile[];
  indexDtsSource: string;
};

export type CanvasSdkResourceManifest = {
  moduleSpecifier: string;
  importExamples: string[];
  promptRules: string[];
  groups: Array<{
    title: string;
    source: string | null;
    symbols: string[];
    definitionResourceUri: string | null;
  }>;
  definitionResources: Array<{
    filePath: string;
    resourceUri: string;
  }>;
};

export type CanvasSdkResolvedResource = {
  uri: string;
  mimeType: "application/json" | "text/plain";
  text: string;
};

export const CANVAS_SDK_MANIFEST_RESOURCE_URI = "resource://routa/canvas-sdk/manifest";

const canvasSdkManifest = sdkManifestJson as CanvasSdkManifest;

function normalizeDefinitionName(filePath: string): string {
  return path.basename(filePath, ".d.ts");
}

export function getCanvasSdkManifest(): CanvasSdkManifest {
  return canvasSdkManifest;
}

export function getCanvasSdkDefinitionResourceUri(filePath: string): string {
  return `resource://routa/canvas-sdk/defs/${normalizeDefinitionName(filePath)}`;
}

function resolveGroupDefinitionResourceUri(
  group: CanvasSdkExportGroup,
  manifest: CanvasSdkManifest,
): string | null {
  if (!group.source) return null;
  const normalizedSource = group.source.replace(/^\.\//u, "");
  const matchedDefinition = manifest.definitionFiles.find((file) =>
    normalizeDefinitionName(file.path) === normalizedSource
  );
  return matchedDefinition ? getCanvasSdkDefinitionResourceUri(matchedDefinition.path) : null;
}

export function getCanvasSdkResourceManifest(): CanvasSdkResourceManifest {
  const manifest = getCanvasSdkManifest();

  return {
    moduleSpecifier: manifest.moduleSpecifier,
    importExamples: manifest.importExamples,
    promptRules: manifest.promptRules,
    groups: manifest.groups.map((group) => ({
      title: group.title,
      source: group.source,
      symbols: group.symbols.map((symbol) => symbol.name),
      definitionResourceUri: resolveGroupDefinitionResourceUri(group, manifest),
    })),
    definitionResources: manifest.definitionFiles.map((file) => ({
      filePath: file.path,
      resourceUri: getCanvasSdkDefinitionResourceUri(file.path),
    })),
  };
}

export function readCanvasSdkResource(uri: string): CanvasSdkResolvedResource | null {
  if (uri === CANVAS_SDK_MANIFEST_RESOURCE_URI) {
    return {
      uri,
      mimeType: "application/json",
      text: `${JSON.stringify(getCanvasSdkResourceManifest(), null, 2)}\n`,
    };
  }

  const definitionFile = getCanvasSdkManifest().definitionFiles.find((file) =>
    getCanvasSdkDefinitionResourceUri(file.path) === uri
  );
  if (!definitionFile) {
    return null;
  }

  return {
    uri,
    mimeType: "text/plain",
    text: definitionFile.source,
  };
}
