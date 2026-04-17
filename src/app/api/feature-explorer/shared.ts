import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import * as yaml from "js-yaml";

export { isContextError, parseContext, resolveRepoRoot } from "../harness/hooks/shared";
export type { HarnessContext as FeatureExplorerContext } from "../harness/hooks/shared";

const FEATURE_TREE_PATH = "docs/product-specs/FEATURE_TREE.md";
const FEATURE_TREE_INDEX_PATH = "docs/product-specs/feature-tree.index.json";
const APP_ROOT = "src/app";
const MAX_TRANSCRIPT_FILES = 200;
const MAX_TRANSCRIPT_FILE_SIZE = 10 * 1024 * 1024;
const BROAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
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
}

export interface ApiImplementationDetail {
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
}

export type FeatureTreeParsed = FeatureTree;

interface FeatureMetadataRaw {
  capability_groups?: CapabilityGroup[];
  features?: Array<{
    id?: string;
    name?: string;
    group?: string;
    summary?: string;
    status?: string;
    pages?: string[];
    apis?: string[];
    source_files?: string[];
    related_features?: string[];
    domain_objects?: string[];
  }>;
}

interface FeatureTreeFrontmatter {
  feature_metadata?: FeatureMetadataRaw;
}

interface FeatureTreeIndexPayload {
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
    domain?: string;
    method?: string;
    path?: string;
    sourceFiles?: string[];
  }>;
  rustApis?: Array<{
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

export interface FeatureStats {
  featureStats: Record<string, FeatureTreeSummary>;
  fileStats: Record<string, FileStat>;
}

interface TranscriptCandidate {
  transcriptPath: string;
  modifiedMs: number;
}

interface ParsedFeatureTranscript {
  sessionId: string;
  cwd: string;
  updatedAt: string;
  events: unknown[];
}

interface RepoIdentity {
  topLevel: string;
  commonDir: string;
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

function extractFrontmatter(raw: string): string | null {
  const trimmed = raw.replace(/^\uFEFF/, "");
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] ?? null : null;
}

function readFeatureTreeContent(repoRoot: string): string {
  const featureTreePath = path.join(repoRoot, FEATURE_TREE_PATH);
  if (!fs.existsSync(featureTreePath)) {
    throw new Error("FEATURE_TREE.md not found");
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
} {
  const frontendPages: FrontendPageDetail[] = [];
  const apiEndpoints: ApiEndpointDetail[] = [];
  const nextjsApiEndpoints: ApiImplementationDetail[] = [];
  const rustApiEndpoints: ApiImplementationDetail[] = [];

  let section: "frontend" | "contract" | "nextjs" | "rust" | null = null;
  let inTable = false;
  let currentApiGroup = "";

  const frontMarker = "## Frontend Pages";
  const apiMarkers = new Set(["## API Endpoints", "## API Contract Endpoints"]);
  const nextjsMarker = "## Next.js API Routes";
  const rustMarker = "## Rust API Routes";

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

    if (trimmed === nextjsMarker) {
      section = "nextjs";
      inTable = false;
      continue;
    }

    if (trimmed === rustMarker) {
      section = "rust";
      inTable = false;
      continue;
    }

    if (trimmed.startsWith("## ") && trimmed !== frontMarker && !apiMarkers.has(trimmed) && trimmed !== nextjsMarker && trimmed !== rustMarker) {
      section = null;
      inTable = false;
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

    if (section === "contract" || section === "nextjs" || section === "rust") {
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
      ) {
        continue;
      }

      const cells = parseMarkdownRow(trimmed);
      if (cells && cells.length >= 3) {
        if (section === "contract") {
          apiEndpoints.push({
            group: currentApiGroup,
            method: cells[0] ?? "",
            endpoint: stripCodeCell(cells[1] ?? ""),
            description: cells[2] ?? "",
          });
        } else {
          const target = section === "nextjs" ? nextjsApiEndpoints : rustApiEndpoints;
          target.push({
            group: currentApiGroup,
            method: cells[0] ?? "",
            endpoint: stripCodeCell(cells[1] ?? ""),
            sourceFiles: parseSourceFilesCell(cells[2] ?? ""),
          });
        }
      }
    }
  }

  return { frontendPages, apiEndpoints, nextjsApiEndpoints, rustApiEndpoints };
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
  source: FeatureTreeIndexPayload["nextjsApis"] | FeatureTreeIndexPayload["rustApis"],
): ApiImplementationDetail[] {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((api) => ({
      group: api.domain?.trim() ?? "",
      method: api.method?.trim() ?? "",
      endpoint: api.path?.trim() ?? "",
      sourceFiles: Array.isArray(api.sourceFiles)
        ? api.sourceFiles.map((file) => file.trim()).filter(Boolean)
        : [],
    }))
    .filter((api) => api.method && api.endpoint);
}

function deriveFeatureSourceFiles(
  feature: FeatureTreeFeature,
  frontendPages: FrontendPageDetail[],
  nextjsApiEndpoints: ApiImplementationDetail[],
  rustApiEndpoints: ApiImplementationDetail[],
): string[] {
  const sourceFiles = new Set(feature.sourceFiles);
  const pageLookup = new Map(frontendPages.map((page) => [page.route, page.sourceFile]));
  const nextjsLookup = new Map(nextjsApiEndpoints.map((api) => [`${api.method.toUpperCase()} ${api.endpoint}`, api.sourceFiles]));
  const rustLookup = new Map(rustApiEndpoints.map((api) => [`${api.method.toUpperCase()} ${api.endpoint}`, api.sourceFiles]));

  for (const route of feature.pages) {
    const sourceFile = pageLookup.get(route);
    if (sourceFile) {
      sourceFiles.add(sourceFile);
    }
  }

  for (const declaration of feature.apis) {
    const parsed = splitDeclaredApi(declaration);
    const key = `${parsed.method.toUpperCase()} ${parsed.endpoint}`;

    for (const sourceFile of nextjsLookup.get(key) ?? []) {
      sourceFiles.add(sourceFile);
    }
    for (const sourceFile of rustLookup.get(key) ?? []) {
      sourceFiles.add(sourceFile);
    }
  }

  return [...sourceFiles].filter(Boolean).sort();
}

export function parseFeatureTree(repoRoot: string): FeatureTree {
  const raw = readFeatureTreeContent(repoRoot);
  const index = readFeatureTreeIndex(repoRoot);
  const frontmatter = extractFrontmatter(raw);
  if (!frontmatter) {
    throw new Error("FEATURE_TREE.md frontmatter not found");
  }

  const parsed = yaml.load(frontmatter) as FeatureTreeFrontmatter | null;
  const featureMetadata = parsed?.feature_metadata;
  if (!featureMetadata) {
    throw new Error("feature_metadata not found in frontmatter");
  }

  const fallbackTables = parseFeatureTreeTables(raw);
  const frontendPages = toFrontendPagesFromIndex(index);
  const apiEndpoints = toApiEndpointsFromIndex(index);
  const nextjsApiEndpoints = toImplementationApiEndpoints(index?.nextjsApis);
  const rustApiEndpoints = toImplementationApiEndpoints(index?.rustApis);
  const resolvedFrontendPages = frontendPages.length > 0 ? frontendPages : fallbackTables.frontendPages;
  const resolvedApiEndpoints = apiEndpoints.length > 0 ? apiEndpoints : fallbackTables.apiEndpoints;
  const resolvedNextjsApiEndpoints = nextjsApiEndpoints.length > 0 ? nextjsApiEndpoints : fallbackTables.nextjsApiEndpoints;
  const resolvedRustApiEndpoints = rustApiEndpoints.length > 0 ? rustApiEndpoints : fallbackTables.rustApiEndpoints;

  return {
    capabilityGroups: (featureMetadata.capability_groups ?? []).map((group) => ({
      id: group.id ?? "",
      name: group.name ?? "",
      description: group.description ?? "",
    })),
    features: (featureMetadata.features ?? []).map((feature) => {
      const normalizedFeature: FeatureTreeFeature = {
        id: feature.id ?? "",
        name: feature.name ?? "",
        group: feature.group ?? "",
        summary: feature.summary ?? "",
        status: feature.status ?? "",
        pages: Array.isArray(feature.pages) ? [...feature.pages] : [],
        apis: Array.isArray(feature.apis) ? [...feature.apis] : [],
        sourceFiles: Array.isArray(feature.source_files) ? [...feature.source_files] : [],
        relatedFeatures: Array.isArray(feature.related_features) ? [...feature.related_features] : [],
        domainObjects: Array.isArray(feature.domain_objects) ? [...feature.domain_objects] : [],
      };

      return {
        ...normalizedFeature,
        sourceFiles: deriveFeatureSourceFiles(
          normalizedFeature,
          resolvedFrontendPages,
          resolvedNextjsApiEndpoints,
          resolvedRustApiEndpoints,
        ),
      };
    }),
    frontendPages: resolvedFrontendPages,
    apiEndpoints: resolvedApiEndpoints,
    nextjsApiEndpoints: resolvedNextjsApiEndpoints,
    rustApiEndpoints: resolvedRustApiEndpoints,
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
    const routeMatch = feature.pages.includes(surface.route) || feature.apis.includes(surface.route);
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

function commandFromUnknown(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const map = event as Record<string, unknown>;
  const directCommand = stringifyCommand(map.command) ?? stringifyCommand(map.cmd);
  if (directCommand) return directCommand;

  if (typeof map.tool_input === "object" && map.tool_input !== null) {
    const toolInput = map.tool_input as Record<string, unknown>;
    return stringifyCommand(toolInput.command) ?? stringifyCommand(toolInput.cmd);
  }

  return undefined;
}

function commandOutputFromUnknown(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const map = event as Record<string, unknown>;
  const directOutput = firstString(
    map.aggregated_output,
    map.output,
    map.stdout,
    map.stderr,
    map.result,
  );
  if (directOutput) {
    return directOutput;
  }

  if (typeof map.tool_output === "object" && map.tool_output !== null) {
    const toolOutput = map.tool_output as Record<string, unknown>;
    return firstString(
      toolOutput.aggregated_output,
      toolOutput.output,
      toolOutput.stdout,
      toolOutput.stderr,
      toolOutput.result,
    );
  }

  return undefined;
}

function stringifyCommand(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
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

function collectTranscriptCandidates(): TranscriptCandidate[] {
  const roots = [
    path.join(process.env.HOME ?? "", ".codex", "sessions"),
    path.join(process.env.HOME ?? "", ".qoder", "projects"),
    path.join(process.env.HOME ?? "", ".augment", "sessions"),
    path.join(process.env.HOME ?? "", ".claude", "projects"),
  ];

  if (process.env.CLAUDE_CONFIG_DIR) {
    roots.push(path.join(process.env.CLAUDE_CONFIG_DIR, "projects"));
  }

  const queue = roots.filter(Boolean);
  const visited = new Set<string>();
  const collected: TranscriptCandidate[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) {
      const lower = current.toLowerCase();
      if ((lower.endsWith(".jsonl") || lower.endsWith(".json")) && stat.size < MAX_TRANSCRIPT_FILE_SIZE) {
        collected.push({ transcriptPath: current, modifiedMs: stat.mtimeMs });
      }
      continue;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (IGNORED_PATHS.has(entry)) {
        continue;
      }
      queue.push(path.join(current, entry));
    }
  }

  return collected.sort((left, right) => right.modifiedMs - left.modifiedMs);
}

function parseTranscriptUpdatedAt(root: Record<string, unknown>): string {
  const candidates = [
    root.last_seen_at_ms,
    root.updated_at,
    root.updatedAt,
    root.timestamp,
    root.created_at,
    root.createdAt,
  ];

  for (const value of candidates) {
    if (typeof value === "number") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 19);
      }
    }

    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return value.slice(0, 19);
      }
    }
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTranscriptEntries(transcriptPath: string, content: string): Record<string, unknown>[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const payloads: Record<string, unknown>[] = [];

  if (transcriptPath.endsWith(".jsonl")) {
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (isRecord(parsed)) {
          payloads.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return payloads;
  }

  try {
    const parsed = JSON.parse(content);
    if (isRecord(parsed)) {
      payloads.push(parsed);
      return payloads;
    }
  } catch {
    // Fallback to line-oriented parsing below.
  }

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) {
        payloads.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return payloads;
}

function extractEventsFromTranscript(root: unknown): unknown[] {
  if (!root || typeof root !== "object") {
    return [];
  }

  const map = root as Record<string, unknown>;
  const events: unknown[] = [];

  if (Array.isArray(map.events)) {
    events.push(...map.events);
  }

  if (Array.isArray(map.tool_uses)) {
    events.push(...map.tool_uses);
  }

  if (Array.isArray(map.recovered_events)) {
    events.push(...map.recovered_events);
  }

  if (Array.isArray(map.tool_calls)) {
    events.push(...map.tool_calls);
  }

  if (events.length === 0) {
    events.push(root);
  }

  return events;
}

function canonicalizePath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function gitRevParsePath(cwd: string, args: string[]): string | null {
  try {
    const raw = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!raw) {
      return null;
    }
    return path.isAbsolute(raw) ? canonicalizePath(raw) : canonicalizePath(path.join(cwd, raw));
  } catch {
    return null;
  }
}

function resolveRepoIdentity(repoRoot: string): RepoIdentity | null {
  const topLevel = gitRevParsePath(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) {
    return null;
  }

  const commonDir = gitRevParsePath(repoRoot, ["rev-parse", "--git-common-dir"]) ?? canonicalizePath(path.join(topLevel, ".git"));
  return {
    topLevel,
    commonDir,
  };
}

function isSameOrDescendant(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith("../") && !path.isAbsolute(relative));
}

function repoPathMatches(
  repoRoot: string,
  sessionCwd: string,
  repoIdentity: RepoIdentity | null,
  identityCache: Map<string, RepoIdentity | null>,
): boolean {
  const normalizedRepoRoot = canonicalizePath(repoRoot);
  const normalizedSessionCwd = canonicalizePath(sessionCwd);

  if (
    normalizedRepoRoot === normalizedSessionCwd
    || isSameOrDescendant(normalizedRepoRoot, normalizedSessionCwd)
    || isSameOrDescendant(normalizedSessionCwd, normalizedRepoRoot)
  ) {
    return true;
  }

  if (!repoIdentity) {
    return false;
  }

  const cached = identityCache.get(normalizedSessionCwd);
  const sessionIdentity = cached !== undefined ? cached : resolveRepoIdentity(normalizedSessionCwd);
  if (cached === undefined) {
    identityCache.set(normalizedSessionCwd, sessionIdentity);
  }

  return !!sessionIdentity && (
    sessionIdentity.topLevel === repoIdentity.topLevel
    || sessionIdentity.commonDir === repoIdentity.commonDir
  );
}

function parseTranscriptSession(transcriptPath: string, modifiedMs: number): ParsedFeatureTranscript | null {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }

  const entries = parseTranscriptEntries(transcriptPath, content);
  if (entries.length === 0) {
    return null;
  }

  let sessionId = path.basename(transcriptPath);
  let cwd = "";
  let updatedAt = new Date(modifiedMs).toISOString().slice(0, 19);
  const events: unknown[] = [];

  for (const entry of entries) {
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    const topLevelType = typeof entry.type === "string" ? entry.type : undefined;

    if (topLevelType === "session_meta" && payload) {
      sessionId = firstString(
        payload.id,
        payload.session_id,
        payload.sessionId,
        entry.session_id,
        entry.sessionId,
      ) ?? sessionId;
      cwd = firstString(payload.cwd, entry.cwd) ?? cwd;
      updatedAt = parseTranscriptUpdatedAt(payload) || parseTranscriptUpdatedAt(entry) || updatedAt;
      continue;
    }

    sessionId = firstString(
      entry.session_id,
      entry.sessionId,
      payload?.session_id,
      payload?.sessionId,
    ) ?? sessionId;
    cwd = firstString(entry.cwd, payload?.cwd) ?? cwd;
    updatedAt = parseTranscriptUpdatedAt(entry) || parseTranscriptUpdatedAt(payload ?? {}) || updatedAt;

    if ((topLevelType === "event_msg" || topLevelType === "response_item") && payload) {
      events.push(payload);
      continue;
    }

    const nestedEvents = extractEventsFromTranscript(entry);
    if (nestedEvents.length > 0 && !(nestedEvents.length === 1 && nestedEvents[0] === entry)) {
      events.push(...nestedEvents);
    }
  }

  if (!cwd) {
    return null;
  }

  return {
    sessionId,
    cwd,
    updatedAt,
    events,
  };
}

function collectMatchingTranscriptSessions(repoRoot: string): ParsedFeatureTranscript[] {
  const now = Date.now();
  const repoIdentity = resolveRepoIdentity(repoRoot);
  const identityCache = new Map<string, RepoIdentity | null>();
  const matched: ParsedFeatureTranscript[] = [];

  for (const candidate of collectTranscriptCandidates()) {
    if (matched.length >= MAX_TRANSCRIPT_FILES) {
      break;
    }
    if (now - candidate.modifiedMs > BROAD_WINDOW_MS) {
      continue;
    }

    const transcript = parseTranscriptSession(candidate.transcriptPath, candidate.modifiedMs);
    if (!transcript) {
      continue;
    }

    if (!repoPathMatches(repoRoot, transcript.cwd, repoIdentity, identityCache)) {
      continue;
    }

    matched.push(transcript);
  }

  return matched;
}

export function collectFeatureSessionStats(repoRoot: string, featureTree: FeatureTree): FeatureStats {
  const featureStats: Record<string, FeatureTreeSummary> = {};
  const fileStats: Record<string, FileStat> = {};

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
      sessions.add(transcript.sessionId);
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
