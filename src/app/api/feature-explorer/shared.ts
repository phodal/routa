import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export { parseContext, resolveRepoRoot, isContextError } from "../harness/hooks/shared";
export type { HarnessContext as FeatureExplorerContext } from "../harness/hooks/shared";

export interface CapabilityGroup {
  id: string;
  name: string;
  description: string;
}

export interface ProductFeature {
  id: string;
  name: string;
  group: string;
  summary: string;
  status: string;
  pages: string[];
  apis: string[];
  source_files: string[];
  related_features: string[];
  domain_objects: string[];
}

interface FeatureMetadata {
  schema_version?: number;
  capability_groups: CapabilityGroup[];
  features: ProductFeature[];
}

interface FeatureTreeFrontmatter {
  feature_metadata: FeatureMetadata;
}

function extractFrontmatter(raw: string): string | null {
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return null;
  return raw.slice(4, end);
}

export function parseFeatureTree(repoRoot: string): {
  capabilityGroups: CapabilityGroup[];
  features: ProductFeature[];
} {
  const featureTreePath = path.join(repoRoot, "docs/product-specs/FEATURE_TREE.md");
  if (!fs.existsSync(featureTreePath)) {
    throw new Error("FEATURE_TREE.md not found");
  }

  const raw = fs.readFileSync(featureTreePath, "utf-8");
  const frontmatter = extractFrontmatter(raw);
  if (!frontmatter) {
    throw new Error("FEATURE_TREE.md frontmatter not found");
  }

  const parsed = yaml.load(frontmatter) as FeatureTreeFrontmatter;
  const metadata = parsed?.feature_metadata;
  if (!metadata) {
    throw new Error("feature_metadata not found in frontmatter");
  }

  return {
    capabilityGroups: metadata.capability_groups ?? [],
    features: (metadata.features ?? []).map((f) => ({
      id: f.id ?? "",
      name: f.name ?? "",
      group: f.group ?? "",
      summary: f.summary ?? "",
      status: f.status ?? "",
      pages: f.pages ?? [],
      apis: f.apis ?? [],
      source_files: f.source_files ?? [],
      related_features: f.related_features ?? [],
      domain_objects: f.domain_objects ?? [],
    })),
  };
}

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  children: FileTreeNode[];
}

export function buildFileTree(sourceFiles: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const filePath of sourceFiles) {
    const parts = filePath.split("/");
    insertIntoTree(root, parts, filePath);
  }

  return root;
}

function insertIntoTree(children: FileTreeNode[], parts: string[], fullPath: string): void {
  if (parts.length === 0) return;

  const name = parts[0];
  const isLeaf = parts.length === 1;

  const existing = children.find((c) => c.name === name);
  if (existing) {
    if (!isLeaf) {
      insertIntoTree(existing.children, parts.slice(1), fullPath);
    }
    return;
  }

  const depth = fullPath.split("/").length - parts.length;
  const nodePath = fullPath
    .split("/")
    .slice(0, depth + 1)
    .join("/");

  const node: FileTreeNode = {
    id: nodePath.replace(/\//g, "-").replace(/[[\]]/g, ""),
    name,
    path: nodePath,
    kind: isLeaf ? "file" : "folder",
    children: [],
  };

  if (!isLeaf) {
    insertIntoTree(node.children, parts.slice(1), fullPath);
  }

  children.push(node);
}
