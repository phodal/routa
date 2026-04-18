import fs from "fs";
import path from "path";

import featureTreeSpecManifestJson from "../../../resources/specialists/specs/feature-tree/manifest.json";

export type FeatureTreeFrameworkSpecEntry = {
  id: string;
  title: string;
  resourceUri: string;
  fileName: string;
  description: string;
  signals: string[];
};

export type FeatureTreeSpecManifest = {
  schemaVersion: number;
  id: string;
  description: string;
  baseRulesInPrompt: boolean;
  availableSpecIds: string[];
  selectionRules: string[];
  specs: FeatureTreeFrameworkSpecEntry[];
};

export type FeatureTreeSpecResolvedResource = {
  uri: string;
  mimeType: "application/json" | "text/markdown";
  text: string;
};

export const FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI =
  "resource://routa/specialists/feature-tree/manifest";

const featureTreeSpecManifest = featureTreeSpecManifestJson as FeatureTreeSpecManifest;
const featureTreeSpecRootDir = path.join(
  process.cwd(),
  "resources",
  "specialists",
  "specs",
  "feature-tree",
);

export function getFeatureTreeSpecManifest(): FeatureTreeSpecManifest {
  return featureTreeSpecManifest;
}

export function getFeatureTreeSpecResourceUris(): string[] {
  return getFeatureTreeSpecManifest().specs.map((spec) => spec.resourceUri);
}

export function getFeatureTreeSpecEntryById(id: string): FeatureTreeFrameworkSpecEntry | undefined {
  return getFeatureTreeSpecManifest().specs.find((spec) => spec.id === id);
}

export function readFeatureTreeSpecResource(uri: string): FeatureTreeSpecResolvedResource | null {
  if (uri === FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI) {
    return {
      uri,
      mimeType: "application/json",
      text: `${JSON.stringify(getFeatureTreeSpecManifest(), null, 2)}\n`,
    };
  }

  const spec = getFeatureTreeSpecManifest().specs.find((entry) => entry.resourceUri === uri);
  if (!spec) {
    return null;
  }

  const filePath = path.join(featureTreeSpecRootDir, spec.fileName);
  const text = fs.readFileSync(filePath, "utf-8");

  return {
    uri,
    mimeType: "text/markdown",
    text,
  };
}

export function buildFeatureTreeSpecPromptSection(): string {
  const manifest = getFeatureTreeSpecManifest();
  const exampleUris = manifest.specs
    .map((spec) => `- ${spec.id}: ${spec.resourceUri}`)
    .join("\n");

  return [
    "Framework overlay spec access:",
    "- Base feature-grouping rules are already built into this system prompt.",
    `- Read the manifest first: \`${FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI}\`.`,
    "- If your provider supports MCP resources/read directly, use that.",
    "- Otherwise call MCP tool `read_specialist_spec_resource` with the same URI.",
    `- Current bundled framework spec ids: ${manifest.availableSpecIds.join(", ")}.`,
    "- After reading the manifest, load only the framework specs supported by repository evidence.",
    "- A repository may need multiple framework specs when it has multiple runtime surfaces, such as Next.js plus Axum.",
    "- If no matching framework spec exists, continue with the built-in path model and repository evidence only.",
    "- Available framework spec resources:",
    exampleUris,
  ].join("\n");
}
