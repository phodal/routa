import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
const featureTreeSpecModuleDir = path.dirname(fileURLToPath(import.meta.url));

function collectSpecialistRootCandidates(baseDir: string): string[] {
  const resolvedBaseDir = path.resolve(baseDir);
  const candidates: string[] = [];
  let current = resolvedBaseDir;

  while (true) {
    candidates.push(path.join(current, "specialists"));
    candidates.push(path.join(current, "resources", "specialists"));

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return candidates;
}

function resolveFeatureTreeSpecRootDir(): string {
  const envRoot = process.env.ROUTA_SPECIALISTS_RESOURCE_DIR?.trim();
  const candidateRoots = [
    ...(envRoot ? [
      path.resolve(envRoot),
      path.resolve(envRoot, "specialists"),
      path.resolve(envRoot, "resources", "specialists"),
    ] : []),
    ...collectSpecialistRootCandidates(featureTreeSpecModuleDir),
  ];

  const uniqueRoots = [...new Set(candidateRoots)];
  for (const root of uniqueRoots) {
    const specRoot = path.join(root, "specs", "feature-tree");
    const manifestPath = path.join(specRoot, "manifest.json");
    if (!existsSync(manifestPath)) {
      continue;
    }

    const allSpecFilesExist = featureTreeSpecManifest.specs.every((spec) =>
      spec.fileName
      && path.basename(spec.fileName) === spec.fileName
      && existsSync(path.join(specRoot, spec.fileName)),
    );
    if (allSpecFilesExist) {
      return specRoot;
    }
  }

  throw new Error(
    "Unable to resolve bundled feature-tree specialist specs. " +
    "Set ROUTA_SPECIALISTS_RESOURCE_DIR or run from a traced Routa build.",
  );
}

const featureTreeSpecRootDir = resolveFeatureTreeSpecRootDir();

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
  const text = readFileSync(filePath, "utf-8");

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
