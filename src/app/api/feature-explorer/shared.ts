import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import featureSurfaceMetadata from "@/core/spec/feature-surface-metadata";
import {
  collectMatchingTranscriptSessions,
  commandFromUnknown,
  commandOutputFromUnknown,
} from "./transcript-sessions";
import type { TranscriptProvider } from "./transcript-sessions";

const { buildApiLookupKey, normalizeSurfaceMetadata } = featureSurfaceMetadata;

export { isContextError, parseContext, resolveRepoRoot } from "../harness/hooks/shared";
export type { HarnessContext as FeatureExplorerContext } from "../harness/hooks/shared";
export type { TranscriptProvider } from "./transcript-sessions";

const FEATURE_TREE_PATH = "docs/product-specs/FEATURE_TREE.md";
const FEATURE_TREE_INDEX_PATH = "docs/product-specs/feature-tree.index.json";
const APP_ROOT = "src/app";
const MAX_FILE_SIGNAL_SESSIONS = 6;
const MAX_FILE_SIGNAL_TOOLS = 8;
const MAX_FILE_SIGNAL_PROMPTS = 6;
const MAX_FILE_SIGNAL_CHANGED_FILES = 12;
const MAX_FILE_SIGNAL_FAILED_TOOLS = 6;
const MAX_FILE_SIGNAL_REPEATED_COMMANDS = 6;
const IGNORED_PATHS = new Set([".git", "node_modules", ".next", "dist", "out", "target"]);

type FallbackSourceDir = string;

export interface CapabilityGroup {
  id: string;
  name: string;
  description: string;
}

export interface FeatureTreeFeature {
  id: string;
  name: string;
  group: string;
  summary: string;
  status: string;
  pages: string[];
  apis: string[];
  sourceFiles: string[];
  relatedFeatures: string[];
  domainObjects: string[];
}

export interface FrontendPageDetail {
  name: string;
  route: string;
  description: string;
  sourceFile: string;
}

export interface ApiEndpointDetail {
  group: string;
  method: string;
  endpoint: string;
  description: string;
  nextjsSourceFiles?: string[];
  rustSourceFiles?: string[];
  implementationSources?: Array<{
    label: string;
    sourceFiles: string[];
  }>;
}

export interface ApiImplementationDetail {
  label: string;
  group: string;
  method: string;
  endpoint: string;
  sourceFiles: string[];
}

export interface FeatureTree {
  capabilityGroups: CapabilityGroup[];
  features: FeatureTreeFeature[];
  frontendPages: FrontendPageDetail[];
  apiEndpoints: ApiEndpointDetail[];
  nextjsApiEndpoints: ApiImplementationDetail[];
  rustApiEndpoints: ApiImplementationDetail[];
  implementationApiEndpoints: ApiImplementationDetail[];
}

export type FeatureTreeParsed = FeatureTree;

interface FeatureMetadataRaw {
  schemaVersion?: number;
  capability_groups?: CapabilityGroup[];
  capabilityGroups?: CapabilityGroup[];
  features?: Array<{
    id?: string;
    name?: string;
    group?: string;
    summary?: string;
    status?: string;
    pages?: string[];
    apis?: string[];
    source_files?: string[];
    sourceFiles?: string[];
    related_features?: string[];
    relatedFeatures?: string[];
    domain_objects?: string[];
    domainObjects?: string[];
  }>;
}

interface FeatureTreeFrontmatter {
  feature_metadata?: FeatureMetadataRaw;
}

interface FeatureTreeIndexPayload {
  metadata?: {
    schemaVersion?: number;
    capabilityGroups?: CapabilityGroup[];
    features?: Array<{
      id?: string;
      name?: string;
      group?: string;
      summary?: string;
      status?: string;
      pages?: string[];
      apis?: string[];
      sourceFiles?: string[];
      source_files?: string[];
      relatedFeatures?: string[];
      related_features?: string[];
      domainObjects?: string[];
      domain_objects?: string[];
    }>;
  };
  pages?: Array<{
    route?: string;
    title?: string;
    description?: string;
    sourceFile?: string;
  }>;
  apis?: Array<{
    domain?: string;
    method?: string;
    path?: string;
    summary?: string;
  }>;
  contractApis?: Array<{
    domain?: string;
    method?: string;
    path?: string;
    summary?: string;
  }>;
  nextjsApis?: Array<{
    label?: string;
    domain?: string;
    method?: string;
    path?: string;
    sourceFiles?: string[];
  }>;
  rustApis?: Array<{
    label?: string;
    domain?: string;
    method?: string;
    path?: string;
    sourceFiles?: string[];
  }>;
  implementationApis?: Array<{
    label?: string;
    domain?: string;
    method?: string;
    path?: string;
    sourceFiles?: string[];
  }>;
}

export interface SurfaceCatalog {
  kind: "Page" | "API";
  route: string;
  sourcePath: string;
  sourceDir: string;
}

export interface SurfaceLink {
  kind: string;
  route: string;
  sourcePath: string;
  confidence: "High" | "Medium";
}

export interface FeatureLink {
  featureId: string;
  featureName: string;
  route?: string;
  viaPath: string;
  confidence: "High" | "Medium";
}

export interface FeatureTreeSummary {
  sessionCount: number;
  changedFiles: number;
  updatedAt: string;
  matchedFiles: string[];
}

export interface FileStat {
  changes: number;
  sessions: number;
  updatedAt: string;
}

export interface FileSessionSignal {
  provider: TranscriptProvider;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  promptHistory: string[];
  toolNames: string[];
  changedFiles?: string[];
  resumeCommand?: string;
  diagnostics?: FileSessionDiagnostics;
}

export interface FileSignal {
  sessions: FileSessionSignal[];
  toolHistory: string[];
  promptHistory: string[];
}

export interface FileSessionToolFailure {
  toolName: string;
  command?: string;
  message: string;
}

export interface FileSessionDiagnostics {
  toolCallCount: number;
  failedToolCallCount: number;
  toolCallsByName: Record<string, number>;
  readFiles: string[];
  writtenFiles: string[];
  repeatedReadFiles: string[];
  repeatedCommands: string[];
  failedTools: FileSessionToolFailure[];
}

export interface FeatureStats {
  featureStats: Record<string, FeatureTreeSummary>;
  fileStats: Record<string, FileStat>;
  fileSignals: Record<string, FileSignal>;
}

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  children: FileTreeNode[];
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractFrontmatter(raw: string): string | null {
  const trimmed = raw.replace(/^\uFEFF/, "");
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] ?? null : null;
}

function readFeatureTreeContent(repoRoot: string): string | null {
  const featureTreePath = path.join(repoRoot, FEATURE_TREE_PATH);
  if (!fs.existsSync(featureTreePath)) {
    return null;
  }
  return fs.readFileSync(featureTreePath, "utf8");
}

function readFeatureTreeIndex(repoRoot: string): FeatureTreeIndexPayload | null {
  const indexPath = path.join(repoRoot, FEATURE_TREE_INDEX_PATH);
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw) as FeatureTreeIndexPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseMarkdownRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function stripCodeCell(value: string): string {
  return value.trim().replace(/^`+|`+$/g, "");
}

function normalizeDomainHeading(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeImplementationLabel(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  const parts = normalized.split(/\s+/);
  if (parts.join("") === "nextjs") {
    return "nextjs";
  }

  return parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

function implementationSectionLabelFromHeading(heading: string): string | null {
  const match = heading
    .trim()
    .match(/^##\s+(.+?)\s+(?:API Routes|API Route Sources|API Source Files)$/u);
  if (!match) {
    return null;
  }

  const label = normalizeImplementationLabel(match[1] ?? "");
  return label || null;
}

function parseSourceFilesCell(value: string): string[] {
  const codeMatches = [...value.matchAll(/`([^`]+)`/g)]
    .map((match) => stripCodeCell(match[1] ?? ""))
    .filter(Boolean);
  if (codeMatches.length > 0) {
    return [...new Set(codeMatches)];
  }

  return value
    .split(",")
    .map((part) => stripCodeCell(part))
    .filter(Boolean);
}

function parseFeatureTreeTables(raw: string): {
  frontendPages: FrontendPageDetail[];
  apiEndpoints: ApiEndpointDetail[];
  nextjsApiEndpoints: ApiImplementationDetail[];
  rustApiEndpoints: ApiImplementationDetail[];
  implementationApiEndpoints: ApiImplementationDetail[];
} {
  const frontendPages: FrontendPageDetail[] = [];
  const apiEndpoints: ApiEndpointDetail[] = [];
  const nextjsApiEndpoints: ApiImplementationDetail[] = [];
  const rustApiEndpoints: ApiImplementationDetail[] = [];
  const implementationApiEndpoints: ApiImplementationDetail[] = [];

  let section: "frontend" | "contract" | "implementation" | null = null;
  let inTable = false;
  let currentApiGroup = "";
  let currentImplementationLabel = "";

  const frontMarker = "## Frontend Pages";
  const apiMarkers = new Set(["## API Endpoints", "## API Contract Endpoints", "## HTTP Contract Endpoints"]);
  const nextjsMarkers = new Set(["## Next.js API Routes", "## Next.js-only API Routes"]);
  const rustMarkers = new Set(["## Rust API Routes", "## Rust-only API Routes"]);

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (trimmed === frontMarker) {
      section = "frontend";
      inTable = false;
      continue;
    }

    if (apiMarkers.has(trimmed)) {
      section = "contract";
      inTable = false;
      continue;
    }

    if (nextjsMarkers.has(trimmed)) {
      section = "implementation";
      inTable = false;
      currentImplementationLabel = "nextjs";
      continue;
    }

    if (rustMarkers.has(trimmed)) {
      section = "implementation";
      inTable = false;
      currentImplementationLabel = "rust";
      continue;
    }

    const implementationLabel = implementationSectionLabelFromHeading(trimmed);
    if (implementationLabel) {
      section = "implementation";
      inTable = false;
      currentImplementationLabel = implementationLabel;
      continue;
    }

    if (trimmed.startsWith("## ") && trimmed !== frontMarker && !apiMarkers.has(trimmed) && !nextjsMarkers.has(trimmed) && !rustMarkers.has(trimmed)) {
      section = null;
      inTable = false;
      currentImplementationLabel = "";
      continue;
    }

    if (section === "frontend") {
      if (trimmed === "| Page | Route | Description |" || trimmed === "| Page | Route | Source File | Description |") {
        inTable = true;
        continue;
      }

      if (!trimmed) {
        inTable = false;
        continue;
      }

      if (!inTable) {
        continue;
      }

      if (trimmed === "|------|-------|-------------|" || trimmed === "|------|-------|-------------|-------------|") {
        continue;
      }

      const cells = parseMarkdownRow(trimmed);
      if (cells && cells.length >= 3) {
        frontendPages.push({
          name: cells[0] ?? "",
          route: stripCodeCell(cells[1] ?? ""),
          sourceFile: cells.length >= 4 ? stripCodeCell(cells[2] ?? "") : "",
          description: cells.length >= 4 ? (cells[3] ?? "") : (cells[2] ?? ""),
        });
      }
      continue;
    }

    if (section === "contract" || section === "implementation") {
      if (trimmed.startsWith("### ")) {
        currentApiGroup = normalizeDomainHeading(trimmed
          .replace(/^###\s+/, "")
          .replace(/\s+\(\d+\)\s*$/, "")
          .trim());
        inTable = false;
        continue;
      }

      if (
        trimmed === "| Method | Endpoint | Description |"
        || trimmed === "| Method | Endpoint | Details |"
        || trimmed === "| Method | Endpoint | Details | Next.js | Rust |"
        || trimmed === "| Method | Endpoint | Source Files |"
      ) {
        inTable = true;
        continue;
      }

      if (!trimmed) {
        inTable = false;
        continue;
      }

      if (!inTable) {
        continue;
      }

      if (
        trimmed === "|--------|----------|-------------|"
        || trimmed === "|--------|----------|---------|"
        || trimmed === "|--------|----------|---------|---------|------|"
        || trimmed === "|--------|----------|--------------|"
      ) {
        continue;
      }

      const cells = parseMarkdownRow(trimmed);
      if (cells && cells.length >= 3) {
        if (section === "contract") {
          const nextjsSourceFiles = cells.length >= 5 ? parseSourceFilesCell(cells[3] ?? "") : [];
          const rustSourceFiles = cells.length >= 5 ? parseSourceFilesCell(cells[4] ?? "") : [];
          apiEndpoints.push({
            group: currentApiGroup,
            method: cells[0] ?? "",
            endpoint: stripCodeCell(cells[1] ?? ""),
            description: cells[2] ?? "",
            ...(nextjsSourceFiles.length > 0 ? { nextjsSourceFiles } : {}),
            ...(rustSourceFiles.length > 0 ? { rustSourceFiles } : {}),
          });

          if (nextjsSourceFiles.length > 0) {
            const nextjsApi = {
              label: "nextjs",
              group: currentApiGroup,
              method: cells[0] ?? "",
              endpoint: stripCodeCell(cells[1] ?? ""),
              sourceFiles: nextjsSourceFiles,
            };
            nextjsApiEndpoints.push(nextjsApi);
            implementationApiEndpoints.push(nextjsApi);
          }

          if (rustSourceFiles.length > 0) {
            const rustApi = {
              label: "rust",
              group: currentApiGroup,
              method: cells[0] ?? "",
              endpoint: stripCodeCell(cells[1] ?? ""),
              sourceFiles: rustSourceFiles,
            };
            rustApiEndpoints.push(rustApi);
            implementationApiEndpoints.push(rustApi);
          }
        } else {
          const implementationApi = {
            label: currentImplementationLabel || "implementation",
            group: currentApiGroup,
            method: cells[0] ?? "",
            endpoint: stripCodeCell(cells[1] ?? ""),
            sourceFiles: parseSourceFilesCell(cells[2] ?? ""),
          };
          implementationApiEndpoints.push(implementationApi);
          if (implementationApi.label === "nextjs") {
            nextjsApiEndpoints.push(implementationApi);
          } else if (implementationApi.label === "rust") {
            rustApiEndpoints.push(implementationApi);
          }
        }
      }
    }
  }

  return {
    frontendPages,
    apiEndpoints,
    nextjsApiEndpoints,
    rustApiEndpoints,
    implementationApiEndpoints,
  };
}

function toFrontendPagesFromIndex(payload: FeatureTreeIndexPayload | null): FrontendPageDetail[] {
  if (!payload?.pages || !Array.isArray(payload.pages)) {
    return [];
  }

  return payload.pages
    .map((page) => ({
      name: page.title?.trim() ?? "",
      route: page.route?.trim() ?? "",
      description: page.description?.trim() ?? "",
      sourceFile: page.sourceFile?.trim() ?? "",
    }))
    .filter((page) => page.name && page.route);
}

function toApiEndpointsFromIndex(payload: FeatureTreeIndexPayload | null): ApiEndpointDetail[] {
  const source = Array.isArray(payload?.contractApis) ? payload?.contractApis : payload?.apis;
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((api) => ({
      group: api.domain?.trim() ?? "",
      method: api.method?.trim() ?? "",
      endpoint: api.path?.trim() ?? "",
      description: api.summary?.trim() ?? "",
    }))
    .filter((api) => api.method && api.endpoint);
}

function toImplementationApiEndpoints(
  source:
    | FeatureTreeIndexPayload["nextjsApis"]
    | FeatureTreeIndexPayload["rustApis"]
    | FeatureTreeIndexPayload["implementationApis"],
  fallbackLabel?: string,
): ApiImplementationDetail[] {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((api) => ({
      label: normalizeImplementationLabel(api.label?.trim() ?? fallbackLabel ?? "implementation"),
      group: api.domain?.trim() ?? "",
      method: api.method?.trim() ?? "",
      endpoint: api.path?.trim() ?? "",
      sourceFiles: Array.isArray(api.sourceFiles)
        ? api.sourceFiles.map((file) => file.trim()).filter(Boolean)
        : [],
    }))
    .filter((api) => api.label && api.method && api.endpoint);
}

function mergeImplementationApiEndpoints(...lists: ApiImplementationDetail[][]): ApiImplementationDetail[] {
  const merged = new Map<string, ApiImplementationDetail>();

  for (const api of lists.flat()) {
    const key = `${api.label}:${buildApiLookupKey(api.method, api.endpoint)}`;
    const existing = merged.get(key);
    if (existing) {
      existing.sourceFiles = [...new Set([...existing.sourceFiles, ...api.sourceFiles])].sort();
      if (!existing.group && api.group) {
        existing.group = api.group;
      }
      continue;
    }

    merged.set(key, {
      label: api.label,
      group: api.group,
      method: api.method,
      endpoint: api.endpoint,
      sourceFiles: [...new Set(api.sourceFiles)].sort(),
    });
  }

  return [...merged.values()].sort((left, right) =>
    left.label.localeCompare(right.label)
    || left.group.localeCompare(right.group)
    || left.endpoint.localeCompare(right.endpoint)
    || left.method.localeCompare(right.method),
  );
}

function toSurfaceMetadata(
  featureMetadata: FeatureMetadataRaw | FeatureTreeIndexPayload["metadata"] | null | undefined,
) {
  if (!featureMetadata) {
    return null;
  }

  const capabilityGroups = Array.isArray((featureMetadata as FeatureMetadataRaw).capability_groups)
    ? (featureMetadata as FeatureMetadataRaw).capability_groups ?? []
    : Array.isArray((featureMetadata as { capabilityGroups?: CapabilityGroup[] }).capabilityGroups)
      ? (featureMetadata as { capabilityGroups?: CapabilityGroup[] }).capabilityGroups ?? []
      : [];
  const features = Array.isArray(featureMetadata.features)
    ? featureMetadata.features
    : [];

  return {
    schemaVersion: typeof featureMetadata.schemaVersion === "number" ? featureMetadata.schemaVersion : 1,
    capabilityGroups: capabilityGroups.map((group: CapabilityGroup) => ({
      id: group.id ?? "",
      name: group.name ?? "",
      description: group.description ?? "",
    })),
    features: features.map((feature) => ({
      id: feature.id ?? "",
      name: feature.name ?? "",
      group: feature.group ?? "",
      summary: feature.summary ?? "",
      status: feature.status ?? "",
      pages: Array.isArray(feature.pages) ? [...feature.pages] : [],
      apis: Array.isArray(feature.apis) ? [...feature.apis] : [],
      sourceFiles: Array.isArray(feature.source_files)
        ? [...feature.source_files]
        : Array.isArray(feature.sourceFiles)
          ? [...feature.sourceFiles]
          : [],
      relatedFeatures: Array.isArray(feature.related_features)
        ? [...feature.related_features]
        : Array.isArray(feature.relatedFeatures)
          ? [...feature.relatedFeatures]
          : [],
      domainObjects: Array.isArray(feature.domain_objects)
        ? [...feature.domain_objects]
        : Array.isArray(feature.domainObjects)
          ? [...feature.domainObjects]
          : [],
    })),
  };
}

export function parseFeatureTree(repoRoot: string): FeatureTree {
  const raw = readFeatureTreeContent(repoRoot);
  const index = readFeatureTreeIndex(repoRoot);
  let metadata = toSurfaceMetadata(index?.metadata);

  if (raw) {
    const frontmatter = extractFrontmatter(raw);
    if (frontmatter) {
      try {
        const parsed = yaml.load(frontmatter) as FeatureTreeFrontmatter | null;
        metadata = toSurfaceMetadata(parsed?.feature_metadata) ?? metadata;
      } catch {
        // Fall back to generated index data or empty metadata when older markdown cannot be parsed.
      }
    }
  }

  const fallbackTables = raw
    ? parseFeatureTreeTables(raw)
    : {
        frontendPages: [],
        apiEndpoints: [],
        nextjsApiEndpoints: [],
        rustApiEndpoints: [],
        implementationApiEndpoints: [],
      };
  const frontendPages = toFrontendPagesFromIndex(index);
  const apiEndpoints = toApiEndpointsFromIndex(index);
  const nextjsApiEndpoints = toImplementationApiEndpoints(index?.nextjsApis, "nextjs");
  const rustApiEndpoints = toImplementationApiEndpoints(index?.rustApis, "rust");
  const implementationApiEndpoints = toImplementationApiEndpoints(index?.implementationApis);
  const resolvedFrontendPages = frontendPages.length > 0 ? frontendPages : fallbackTables.frontendPages;
  const resolvedApiEndpoints = apiEndpoints.length > 0 ? apiEndpoints : fallbackTables.apiEndpoints;
  const resolvedNextjsApiEndpoints = nextjsApiEndpoints.length > 0 ? nextjsApiEndpoints : fallbackTables.nextjsApiEndpoints;
  const resolvedRustApiEndpoints = rustApiEndpoints.length > 0 ? rustApiEndpoints : fallbackTables.rustApiEndpoints;
  const resolvedImplementationApiEndpoints = mergeImplementationApiEndpoints(
    implementationApiEndpoints,
    resolvedNextjsApiEndpoints,
    resolvedRustApiEndpoints,
    fallbackTables.implementationApiEndpoints,
  );
  const normalizedMetadata = normalizeSurfaceMetadata({
    metadata,
    pages: resolvedFrontendPages.map((page) => ({
      route: page.route,
      title: page.name,
      description: page.description,
      sourceFile: page.sourceFile,
    })),
    contractApis: resolvedApiEndpoints.map((api) => ({
      domain: api.group,
      method: api.method,
      path: api.endpoint,
      summary: api.description,
    })),
    nextjsApis: resolvedNextjsApiEndpoints.map((api) => ({
      domain: api.group,
      method: api.method,
      path: api.endpoint,
      sourceFiles: api.sourceFiles,
    })),
    rustApis: resolvedRustApiEndpoints.map((api) => ({
      domain: api.group,
      method: api.method,
      path: api.endpoint,
      sourceFiles: api.sourceFiles,
    })),
    implementationApis: resolvedImplementationApiEndpoints.map((api) => ({
      domain: api.group,
      method: api.method,
      path: api.endpoint,
      sourceFiles: api.sourceFiles,
    })),
  });

  return {
    capabilityGroups: (normalizedMetadata?.capabilityGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description ?? "",
    })),
    features: (normalizedMetadata?.features ?? []).map((feature) => ({
      id: feature.id,
      name: feature.name,
      group: feature.group ?? "",
      summary: feature.summary ?? "",
      status: feature.status ?? "",
      pages: Array.isArray(feature.pages) ? [...feature.pages] : [],
      apis: Array.isArray(feature.apis) ? [...feature.apis] : [],
      sourceFiles: Array.isArray(feature.sourceFiles) ? [...feature.sourceFiles] : [],
      relatedFeatures: Array.isArray(feature.relatedFeatures) ? [...feature.relatedFeatures] : [],
      domainObjects: Array.isArray(feature.domainObjects) ? [...feature.domainObjects] : [],
    })),
    frontendPages: resolvedFrontendPages,
    apiEndpoints: resolvedApiEndpoints,
    nextjsApiEndpoints: resolvedNextjsApiEndpoints,
    rustApiEndpoints: resolvedRustApiEndpoints,
    implementationApiEndpoints: resolvedImplementationApiEndpoints,
  };
}

function normalizePageSegment(segment: string): string {
  if (!segment.startsWith("[") || !segment.endsWith("]")) {
    return segment;
  }

  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `:${segment.slice(4, -1)}`;
  }

  return `:${segment.slice(1, -1)}`;
}

function normalizeApiSegment(segment: string): string {
  if (!segment.startsWith("[") || !segment.endsWith("]")) {
    return segment;
  }

  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `{${segment.slice(4, -1)}}`;
  }

  return `{${segment.slice(1, -1)}}`;
}

function normalizePageRoute(sourcePath: string): string {
  if (sourcePath === "src/app/page.tsx") {
    return "/";
  }

  const normalized = toPosix(sourcePath)
    .replace(/^src\/app\//, "")
    .replace(/\/page\.tsx$/, "");

  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(normalizePageSegment);

  return `/${segments.join("/")}`;
}

function normalizeApiRoute(sourcePath: string): string {
  const normalized = toPosix(sourcePath)
    .replace(/^src\/app\//, "")
    .replace(/\/route\.ts$/, "");

  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(normalizeApiSegment);

  return `/${segments.join("/")}`;
}

function walkAppFiles(root: string, current: string, out: string[]): void {
  if (!fs.existsSync(current)) {
    return;
  }

  const stat = fs.statSync(current);
  if (!stat.isDirectory()) {
    if (current.endsWith(".tsx") || current.endsWith(".ts")) {
      out.push(toPosix(path.relative(root, current)));
    }
    return;
  }

  for (const entry of fs.readdirSync(current)) {
    if (IGNORED_PATHS.has(entry)) {
      continue;
    }
    walkAppFiles(root, path.join(current, entry), out);
  }
}

function getFallbackSourceDirs(featureSourceFiles: string[]): FallbackSourceDir[] {
  const sourceDirs = new Set<string>();

  for (const sourceFile of featureSourceFiles) {
    const normalized = toPosix(sourceFile);

    if (!normalized.startsWith(`${APP_ROOT}/`)) {
      continue;
    }

    let sourceDir: string;
    if (normalized.endsWith("/page.tsx")) {
      sourceDir = normalized.slice(0, -"/page.tsx".length);
    } else if (normalized.endsWith("/route.ts")) {
      sourceDir = normalized.slice(0, -"/route.ts".length);
    } else {
      sourceDir = path.posix.dirname(normalized);
    }

    if (sourceDir === APP_ROOT) {
      continue;
    }

    const appRelative = sourceDir.slice(`${APP_ROOT}/`.length);
    const segments = appRelative.split("/").filter(Boolean);
    if (segments.length <= 1) {
      continue;
    }

    if (segments.length === 2 && segments[segments.length - 1] === "[workspaceId]") {
      continue;
    }

    sourceDirs.add(sourceDir);
  }

  return [...sourceDirs];
}

function hasDirectoryMatch(
  featureSourceFiles: string[],
  changedFile: string,
): boolean {
  const fallbackSourceDirs = getFallbackSourceDirs(featureSourceFiles);
  const normalizedChangedFile = toPosix(changedFile);

  return fallbackSourceDirs.some(
    (sourceDir) =>
      normalizedChangedFile === sourceDir || normalizedChangedFile.startsWith(`${sourceDir}/`),
  );
}

export function parseFeatureSurfaceCatalog(repoRoot: string): SurfaceCatalog[] {
  const appRoot = path.join(repoRoot, APP_ROOT);
  const entries: string[] = [];
  walkAppFiles(appRoot, appRoot, entries);

  const catalog: SurfaceCatalog[] = [];

  for (const relativePath of entries) {
    if (relativePath.endsWith("/page.tsx")) {
      const sourcePath = `${APP_ROOT}/${relativePath}`;
      const sourceDir = sourcePath.slice(0, -"/page.tsx".length);
      catalog.push({
        kind: "Page",
        route: normalizePageRoute(sourcePath),
        sourcePath,
        sourceDir,
      });
      continue;
    }

    if (relativePath.endsWith("/route.ts") && relativePath.includes("/api/")) {
      const sourcePath = `${APP_ROOT}/${relativePath}`;
      const sourceDir = sourcePath.slice(0, -"/route.ts".length);
      catalog.push({
        kind: "API",
        route: normalizeApiRoute(sourcePath),
        sourcePath,
        sourceDir,
      });
    }
  }

  return catalog.sort((left, right) => {
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) {
      return byKind;
    }
    return left.route.localeCompare(right.route) || left.sourcePath.localeCompare(right.sourcePath);
  });
}

function specificityFromSourceDir(sourceDir: string): number {
  return sourceDir
    .split("/")
    .filter(Boolean)
    .length;
}

export function parseFeatureSurfaceLinks(catalog: SurfaceCatalog[], changedPath: string): SurfaceLink[] {
  const bestByKind = new Map<string, SurfaceCatalog & { specificity: number; direct: boolean }>();

  for (const surface of catalog) {
    const direct = surface.sourcePath === changedPath;
    const nested = surface.route !== "/" && changedPath.startsWith(`${surface.sourceDir}/`);
    if (!direct && !nested) {
      continue;
    }

    const specificity = specificityFromSourceDir(surface.sourceDir);
    const current = bestByKind.get(surface.kind);

    if (!current) {
      bestByKind.set(surface.kind, { ...surface, specificity, direct });
      continue;
    }

    const replace =
      (direct && !current.direct)
      || (direct === current.direct && specificity > current.specificity);

    if (replace) {
      bestByKind.set(surface.kind, { ...surface, specificity, direct });
    }
  }

  return Array.from(bestByKind.values()).map((value) => ({
    kind: value.kind,
    route: value.route,
    sourcePath: value.sourcePath,
    confidence: value.direct ? "High" : "Medium",
  }));
}

export function parseFeatureTreeLinks(
  feature: FeatureTreeFeature,
  surfaceLinks: SurfaceLink[],
  changedFile: string,
): FeatureLink[] {
  const links: FeatureLink[] = [];
  const seen = new Set<string>();
  let hasExactMatch = false;

  for (const surface of surfaceLinks) {
    const sourceMatch = feature.sourceFiles.includes(changedFile) || feature.sourceFiles.includes(surface.sourcePath);
    const normalizedSurfaceApiPath = buildApiLookupKey("GET", surface.route).slice(4);
    const routeMatch = feature.pages.includes(surface.route)
      || feature.apis.some((declaration) => buildApiLookupKey(splitDeclaredApi(declaration).method, splitDeclaredApi(declaration).endpoint).slice(4) === normalizedSurfaceApiPath);
    if (!sourceMatch && !routeMatch) {
      continue;
    }

    const viaPath = changedFile;
    const key = `${feature.id}|${surface.route}|${viaPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    links.push({
      featureId: feature.id,
      featureName: feature.name,
      route: surface.route,
      viaPath,
      confidence: sourceMatch ? "High" : "Medium",
    });
    hasExactMatch = true;
  }

  if (hasExactMatch) {
    return links;
  }

  if (hasDirectoryMatch(feature.sourceFiles, changedFile)) {
    for (const surface of surfaceLinks) {
      const key = `${feature.id}|${surface.route}|${changedFile}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      links.push({
        featureId: feature.id,
        featureName: feature.name,
        route: surface.route,
        viaPath: changedFile,
        confidence: "Medium",
      });
    }
  }

  return links;
}

function parsePatchBlock(text: string): string[] {
  const out: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const [, , value] = trimmed.match(/^(\*{3} (Update|Add|Delete|Move to):)\s*(.*)$/) ?? [];
    if (!value) {
      continue;
    }
    out.push(value);
  }

  return out;
}

function shellLikeSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseCommandPaths(command: string): string[] {
  const tokens = shellLikeSplit(command);
  if (tokens.length === 0) {
    return [];
  }

  const separatorIndex = tokens.indexOf("--");
  if (separatorIndex >= 0) {
    return tokens
      .slice(separatorIndex + 1)
      .filter((token) => token.length > 0 && !token.startsWith("-"));
  }

  if (tokens[0] === "git" && (tokens[1] === "add" || tokens[1] === "rm")) {
    return tokens
      .slice(2)
      .filter((token) => token.length > 0 && !token.startsWith("-"));
  }

  return [];
}

function collectFileValues(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFileValues(item, out);
    }
    return;
  }

  if (typeof value === "string") {
    for (const candidate of parsePatchBlock(value)) {
      out.add(candidate);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const map = value as Record<string, unknown>;
  const pathKeys = new Set([
    "path",
    "paths",
    "file",
    "filepath",
    "file_path",
    "filename",
    "target",
    "source",
    "target_file",
    "source_file",
    "absolute_path",
    "relative_path",
  ]);

  for (const [key, child] of Object.entries(map)) {
    const lower = key.toLowerCase();
    if (pathKeys.has(lower)) {
      if (typeof child === "string") {
        out.add(child);
      } else if (Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === "string") {
            out.add(item);
          }
        }
      }
    }
    collectFileValues(child, out);
  }
}

function appendLimitedUnique(target: string[], value: string, limit: number): void {
  if (!value || target.includes(value) || target.length >= limit) {
    return;
  }
  target.push(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeCommandSignature(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function truncateDiagnosticText(text: string, maxLength: number = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function unwrapShellCommand(command: string): string {
  const tokens = shellLikeSplit(command);
  if (tokens.length < 3) {
    return command;
  }

  const executable = path.posix.basename(tokens[0] ?? "");
  const shellLike = executable === "sh" || executable === "bash" || executable === "zsh";
  if (!shellLike) {
    return command;
  }

  const cFlagIndex = tokens.findIndex((token) => token === "-c" || token === "-lc");
  if (cFlagIndex >= 0 && tokens[cFlagIndex + 1]) {
    return tokens.slice(cFlagIndex + 1).join(" ");
  }

  return command;
}

function toolNameFromFeatureEvent(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (event.type === "function_call" && typeof event.name === "string") {
    return event.name;
  }

  if (typeof event.tool_name === "string") {
    return event.tool_name;
  }

  if (event.type === "exec_command_end" || event.type === "exec_command_begin") {
    return "exec_command";
  }

  return commandFromUnknown(event) ? "exec_command" : undefined;
}

function extractReadCandidatesFromCommand(command: string): string[] {
  const innerCommand = unwrapShellCommand(command);
  const tokens = shellLikeSplit(innerCommand);
  if (tokens.length === 0) {
    return [];
  }

  const executable = path.posix.basename(tokens[0] ?? "");
  const readCommands = new Set(["bat", "cat", "head", "less", "more", "nl", "sed", "tail"]);
  if (!readCommands.has(executable)) {
    return [];
  }

  return tokens.slice(1).filter((token) => token !== "--" && !token.startsWith("-"));
}

function collectReadFilesFromToolLike(event: unknown, repoRoot: string, sessionCwd: string): string[] {
  const candidates = new Set<string>();
  const toolName = toolNameFromFeatureEvent(event)?.toLowerCase() ?? "";
  const command = commandFromUnknown(event);
  const directReadTool = toolName.includes("read")
    || toolName === "open"
    || toolName === "view"
    || toolName === "fs/read_text_file";

  if (directReadTool) {
    collectFileValues(event, candidates);
  }

  if (command) {
    for (const token of extractReadCandidatesFromCommand(command)) {
      candidates.add(token);
    }
  }

  const readFiles: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeRepoRelative(repoRoot, candidate, sessionCwd);
    if (normalized && !readFiles.includes(normalized)) {
      readFiles.push(normalized);
    }
  }

  return readFiles;
}

function detectFailedToolCall(event: unknown): FileSessionToolFailure | null {
  if (!isRecord(event)) {
    return null;
  }

  const exitCode = typeof event.exit_code === "number"
    ? event.exit_code
    : typeof event.exitCode === "number"
      ? event.exitCode
      : undefined;
  const status = typeof event.status === "string" ? event.status.trim().toLowerCase() : "";
  const failed = (typeof exitCode === "number" && exitCode !== 0)
    || status === "failed"
    || status === "error";

  if (!failed) {
    return null;
  }

  const toolName = toolNameFromFeatureEvent(event) ?? "tool";
  const message = firstNonEmptyString(
    event.stderr,
    event.error,
    event.message,
    commandOutputFromUnknown(event),
  ) ?? (typeof exitCode === "number" ? `Exit code ${exitCode}` : "Tool call failed");

  return {
    toolName,
    ...(commandFromUnknown(event) ? { command: truncateDiagnosticText(commandFromUnknown(event) ?? "") } : {}),
    message: truncateDiagnosticText(message),
  };
}

function deriveTranscriptSessionDiagnostics(
  transcript: ReturnType<typeof collectMatchingTranscriptSessions>[number],
  repoRoot: string,
  writtenFiles: string[],
): FileSessionDiagnostics {
  const toolCallsByName: Record<string, number> = {};
  const readCounts = new Map<string, number>();
  const repeatedCommandCounts = new Map<string, number>();
  const failedTools: FileSessionToolFailure[] = [];
  const pendingExecRequests = new Map<string, number>();
  let failedToolCallCount = 0;

  const incrementToolCall = (toolName: string) => {
    toolCallsByName[toolName] = (toolCallsByName[toolName] ?? 0) + 1;
  };

  const incrementCommand = (signature: string) => {
    if (!signature) {
      return;
    }
    repeatedCommandCounts.set(signature, (repeatedCommandCounts.get(signature) ?? 0) + 1);
  };

  const appendFailure = (failure: FileSessionToolFailure | null) => {
    if (!failure) {
      return;
    }
    failedToolCallCount += 1;
    if (failedTools.length < MAX_FILE_SIGNAL_FAILED_TOOLS) {
      failedTools.push(failure);
    }
  };

  for (const event of transcript.events) {
    const toolName = toolNameFromFeatureEvent(event);
    const command = commandFromUnknown(event);
    const commandSignature = command ? normalizeCommandSignature(unwrapShellCommand(command)) : "";

    for (const readFile of collectReadFilesFromToolLike(event, repoRoot, transcript.cwd)) {
      readCounts.set(readFile, (readCounts.get(readFile) ?? 0) + 1);
    }

    if (!isRecord(event)) {
      continue;
    }

    if (event.type === "function_call") {
      if (toolName) {
        incrementToolCall(toolName);
      }
      if (toolName === "exec_command" && commandSignature) {
        pendingExecRequests.set(commandSignature, (pendingExecRequests.get(commandSignature) ?? 0) + 1);
      }
      incrementCommand(commandSignature);
      appendFailure(detectFailedToolCall(event));
      continue;
    }

    if (event.type === "exec_command_begin" || event.type === "exec_command_end") {
      const pending = commandSignature ? (pendingExecRequests.get(commandSignature) ?? 0) : 0;
      if (pending > 0 && commandSignature) {
        pendingExecRequests.set(commandSignature, pending - 1);
      } else {
        incrementToolCall("exec_command");
        incrementCommand(commandSignature);
      }
      appendFailure(detectFailedToolCall(event));
      continue;
    }

    if (toolName) {
      incrementToolCall(toolName);
      incrementCommand(commandSignature);
      appendFailure(detectFailedToolCall(event));
    }
  }

  const sortedReadFiles = [...readCounts.keys()].sort((left, right) => left.localeCompare(right));
  const repeatedReadFiles = [...readCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([filePath, count]) => `${filePath} x${count}`);
  const repeatedCommands = [...repeatedCommandCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_FILE_SIGNAL_REPEATED_COMMANDS)
    .map(([commandText, count]) => `${truncateDiagnosticText(commandText, 120)} x${count}`);

  return {
    toolCallCount: Object.values(toolCallsByName).reduce((sum, count) => sum + count, 0),
    failedToolCallCount,
    toolCallsByName,
    readFiles: sortedReadFiles,
    writtenFiles: [...new Set(writtenFiles)].sort((left, right) => left.localeCompare(right)),
    repeatedReadFiles,
    repeatedCommands,
    failedTools,
  };
}

function sanitizePathCandidate(candidate: string): string | null {
  const cleaned = toPosix(candidate)
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/^`+|`+$/g, "")
    .replace(/[",;:]+$/g, "");

  if (!cleaned) {
    return null;
  }

  const lineQualifiedPath = cleaned.match(/^(.*\.[^:/\s]+):\d+(?::\d+)?$/);
  if (lineQualifiedPath?.[1]) {
    return lineQualifiedPath[1];
  }

  if (!/\s/.test(cleaned)) {
    return cleaned;
  }

  const embeddedPath = cleaned.match(
    /([A-Za-z0-9_@()[\]{}.\-/]+?\.(?:[cm]?[jt]sx?|jsx?|tsx?|rs|md|json|ya?ml|toml|css|scss|html))/,
  );
  if (embeddedPath?.[1]) {
    return embeddedPath[1];
  }

  return cleaned;
}

function pathLooksFileLike(candidate: string): boolean {
  const base = path.posix.basename(candidate);
  return base.includes(".") || ["Dockerfile", "Makefile", "Cargo.toml"].includes(base);
}

function isExistingDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function normalizeRepoRelative(repoRoot: string, candidate: string, sessionCwd: string): string | null {
  const cleaned = sanitizePathCandidate(candidate);

  if (!cleaned || cleaned === "/dev/null") {
    return null;
  }

  if (!path.isAbsolute(cleaned)) {
    const relativeCandidate = toPosix(cleaned).replace(/^\.\//, "");
    if (!relativeCandidate || relativeCandidate === "." || relativeCandidate.startsWith("../")) {
      return null;
    }
    const repoResolved = path.join(repoRoot, relativeCandidate);
    const sessionResolved = path.join(sessionCwd, relativeCandidate);
    if (isExistingDirectory(repoResolved) || isExistingDirectory(sessionResolved)) {
      return null;
    }
    if (!isExistingFile(repoResolved) && !isExistingFile(sessionResolved) && !pathLooksFileLike(relativeCandidate)) {
      return null;
    }
    return relativeCandidate;
  }

  const candidatePaths = [sessionCwd, repoRoot];
  for (const basePath of candidatePaths) {
    if (isExistingDirectory(cleaned)) {
      return null;
    }
    const relative = path.relative(basePath, cleaned);
    const relativePosix = toPosix(relative);
    if (
      relativePosix
      && !relativePosix.startsWith("../")
      && !path.isAbsolute(relativePosix)
      && (isExistingFile(cleaned) || pathLooksFileLike(relativePosix))
    ) {
      return relativePosix;
    }
  }

  return null;
}

function extractChangedFilesFromCommandOutput(command: string, output: string): string[] {
  const changed = new Set<string>();
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (command.includes("git status --short")) {
    for (const line of lines) {
      const match = line.match(/^[ MADRCU?!]{1,2}\s+(.+)$/);
      const pathCandidate = (match?.[1] ?? line).split(" -> ").pop()?.trim();
      if (pathCandidate) {
        changed.add(pathCandidate);
      }
    }
  }

  if (command.includes("git diff --name-only")) {
    for (const line of lines) {
      changed.add(line);
    }
  }

  if (command.includes("git diff") || command.includes("git show")) {
    for (const line of lines) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match?.[2]) {
        changed.add(match[2]);
      }
    }
  }

  return [...changed];
}

function collectChangedFilesFromToolLike(event: unknown, repoRoot: string, sessionCwd: string): string[] {
  const candidates = new Set<string>();
  collectFileValues(event, candidates);

  const command = commandFromUnknown(event);
  if (typeof command === "string") {
    for (const line of parsePatchBlock(command)) {
      candidates.add(line);
    }
    for (const token of parseCommandPaths(command)) {
      candidates.add(token);
    }
  }
  const commandOutput = commandOutputFromUnknown(event);
  if (command && commandOutput) {
    for (const candidate of extractChangedFilesFromCommandOutput(command, commandOutput)) {
      candidates.add(candidate);
    }
  }

  const changed: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeRepoRelative(repoRoot, candidate, sessionCwd);
    if (normalized) {
      changed.push(normalized);
    }
  }

  return changed;
}

export function collectFeatureSessionStats(repoRoot: string, featureTree: FeatureTree): FeatureStats {
  const featureStats: Record<string, FeatureTreeSummary> = {};
  const fileStats: Record<string, FileStat> = {};
  const fileSignals: Record<string, FileSignal> = {};

  const featureSessionIds = new Map<string, Set<string>>();
  const featureChangedFiles = new Map<string, Set<string>>();
  const featureUpdatedAt = new Map<string, string>();

  const surfaceCatalog = parseFeatureSurfaceCatalog(repoRoot);
  const transcripts = collectMatchingTranscriptSessions(repoRoot);

  for (const transcript of transcripts) {
    const changedFromTranscript = new Set<string>();
    const sessionFeatures = new Set<string>();
    const featureMatchedFiles = new Map<string, Set<string>>();

    for (const event of transcript.events) {
      for (const changed of collectChangedFilesFromToolLike(event, repoRoot, transcript.cwd)) {
        changedFromTranscript.add(changed);
      }
    }

    if (changedFromTranscript.size === 0) {
      continue;
    }

    const transcriptKey = `${transcript.provider}:${transcript.sessionId}`;
    const changedFiles = [...changedFromTranscript]
      .slice(0, MAX_FILE_SIGNAL_CHANGED_FILES)
      .sort((left, right) => left.localeCompare(right));
    const diagnostics = deriveTranscriptSessionDiagnostics(transcript, repoRoot, changedFiles);

    for (const changedFile of changedFromTranscript) {
      const fileEntry = fileStats[changedFile] ?? {
        changes: 0,
        sessions: 0,
        updatedAt: "",
      };
      fileEntry.changes += 1;
      fileEntry.sessions += 1;
      if (!fileEntry.updatedAt || (transcript.updatedAt && transcript.updatedAt > fileEntry.updatedAt)) {
        fileEntry.updatedAt = transcript.updatedAt;
      }
      fileStats[changedFile] = fileEntry;

      const signalEntry = fileSignals[changedFile] ?? {
        sessions: [],
        toolHistory: [],
        promptHistory: [],
      };
      if (
        signalEntry.sessions.length < MAX_FILE_SIGNAL_SESSIONS
        && !signalEntry.sessions.some(
          (session) => `${session.provider}:${session.sessionId}` === transcriptKey,
        )
      ) {
        signalEntry.sessions.push({
          provider: transcript.provider,
          sessionId: transcript.sessionId,
          updatedAt: transcript.updatedAt,
          promptSnippet: transcript.promptHistory[0] ?? "",
          promptHistory: transcript.promptHistory.slice(0, MAX_FILE_SIGNAL_PROMPTS),
          toolNames: transcript.toolHistory.slice(0, MAX_FILE_SIGNAL_TOOLS),
          changedFiles,
          diagnostics,
          ...(transcript.resumeCommand ? { resumeCommand: transcript.resumeCommand } : {}),
        });
      }
      for (const toolName of transcript.toolHistory) {
        appendLimitedUnique(signalEntry.toolHistory, toolName, MAX_FILE_SIGNAL_TOOLS);
      }
      for (const prompt of transcript.promptHistory) {
        appendLimitedUnique(signalEntry.promptHistory, prompt, MAX_FILE_SIGNAL_PROMPTS);
      }
      fileSignals[changedFile] = signalEntry;

      const surfaceLinks = parseFeatureSurfaceLinks(surfaceCatalog, changedFile);

      for (const feature of featureTree.features) {
        const links = parseFeatureTreeLinks(feature, surfaceLinks, changedFile);

        if (links.length > 0) {
          sessionFeatures.add(feature.id);
          const files = featureMatchedFiles.get(feature.id) ?? new Set<string>();
          for (const link of links) {
            files.add(link.viaPath);
          }
          featureMatchedFiles.set(feature.id, files);
          continue;
        }

        if (surfaceLinks.length === 0 && feature.sourceFiles.includes(changedFile)) {
          sessionFeatures.add(feature.id);
          const files = featureMatchedFiles.get(feature.id) ?? new Set<string>();
          files.add(changedFile);
          featureMatchedFiles.set(feature.id, files);
        }
      }
    }

    for (const featureId of sessionFeatures) {
      const sessions = featureSessionIds.get(featureId) ?? new Set<string>();
      sessions.add(transcriptKey);
      featureSessionIds.set(featureId, sessions);

      const changedFiles = featureChangedFiles.get(featureId) ?? new Set<string>();
      for (const changedFile of featureMatchedFiles.get(featureId) ?? changedFromTranscript) {
        changedFiles.add(changedFile);
      }
      featureChangedFiles.set(featureId, changedFiles);

      const currentUpdatedAt = featureUpdatedAt.get(featureId) ?? "";
      if (!currentUpdatedAt || (transcript.updatedAt && transcript.updatedAt > currentUpdatedAt)) {
        featureUpdatedAt.set(featureId, transcript.updatedAt);
      }
    }
  }

  for (const [featureId, sessions] of featureSessionIds.entries()) {
    featureStats[featureId] = {
      sessionCount: sessions.size,
      changedFiles: featureChangedFiles.get(featureId)?.size ?? 0,
      updatedAt: featureUpdatedAt.get(featureId) ?? "",
      matchedFiles: [...(featureChangedFiles.get(featureId) ?? new Set<string>())].sort(),
    };
  }

  return {
    featureStats,
    fileStats,
    fileSignals,
  };
}

export function buildFileTree(sourceFiles: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  function insert(nodes: FileTreeNode[], parts: string[], fullPath: string): void {
    if (parts.length === 0) {
      return;
    }

    const [head, ...tail] = parts;
    const isLeaf = tail.length === 0;
    let existing = nodes.find((node) => node.name === head);

    if (!existing) {
      const depth = fullPath.split("/").length - parts.length;
      const nodePath = fullPath
        .split("/")
        .slice(0, depth + 1)
        .join("/");

      existing = {
        id: nodePath.replace(/\//g, "-").replace(/\[/g, "").replace(/\]/g, ""),
        name: head,
        path: nodePath,
        kind: isLeaf ? "file" : "folder",
        children: [],
      };
      nodes.push(existing);
    }

    if (!isLeaf) {
      insert(existing.children, tail, fullPath);
    }
  }

  for (const filePath of sourceFiles) {
    insert(root, toPosix(filePath).split("/"), toPosix(filePath));
  }

  return root;
}

export function splitDeclaredApi(declaration: string): { method: string; endpoint: string } {
  const [method, endpoint] = declaration.split(/\s+/, 2);
  if (endpoint) {
    return { method, endpoint };
  }

  return { method: "GET", endpoint: declaration };
}
