import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export { isContextError, parseContext, resolveRepoRoot } from "../harness/hooks/shared";
export type { HarnessContext as FeatureExplorerContext } from "../harness/hooks/shared";

const FEATURE_TREE_PATH = "docs/product-specs/FEATURE_TREE.md";
const APP_ROOT = "src/app";
const MAX_TRANSCRIPT_FILES = 200;
const MAX_TRANSCRIPT_FILE_SIZE = 10 * 1024 * 1024;
const IGNORED_PATHS = new Set([".git", "node_modules", ".next", "dist", "out", "target"]);

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
}

export interface ApiEndpointDetail {
  group: string;
  method: string;
  endpoint: string;
  description: string;
}

export interface FeatureTree {
  capabilityGroups: CapabilityGroup[];
  features: FeatureTreeFeature[];
  frontendPages: FrontendPageDetail[];
  apiEndpoints: ApiEndpointDetail[];
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

function parseFeatureTreeTables(raw: string): {
  frontendPages: FrontendPageDetail[];
  apiEndpoints: ApiEndpointDetail[];
} {
  const frontendPages: FrontendPageDetail[] = [];
  const apiEndpoints: ApiEndpointDetail[] = [];

  let inFrontend = false;
  let inApi = false;
  let inTable = false;
  let currentApiGroup = "";

  const frontMarker = "## Frontend Pages";
  const apiMarker = "## API Endpoints";

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (trimmed === frontMarker) {
      inFrontend = true;
      inApi = false;
      inTable = false;
      continue;
    }

    if (trimmed === apiMarker) {
      inApi = true;
      inFrontend = false;
      inTable = false;
      continue;
    }

    if (trimmed.startsWith("## ") && trimmed !== frontMarker && trimmed !== apiMarker) {
      inFrontend = false;
      inApi = false;
      inTable = false;
      continue;
    }

    if (inFrontend) {
      if (trimmed === "| Page | Route | Description |") {
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

      if (trimmed === "|------|-------|-------------|") {
        continue;
      }

      const cells = parseMarkdownRow(trimmed);
      if (cells && cells.length >= 3) {
        frontendPages.push({
          name: cells[0] ?? "",
          route: stripCodeCell(cells[1] ?? ""),
          description: cells[2] ?? "",
        });
      }
      continue;
    }

    if (inApi) {
      if (trimmed.startsWith("### ")) {
        currentApiGroup = trimmed
          .replace(/^###\s+/, "")
          .replace(/\s+\(\d+\)\s*$/, "")
          .trim();
        inTable = false;
        continue;
      }

      if (trimmed === "| Method | Endpoint | Description |") {
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

      if (trimmed === "|--------|----------|-------------|") {
        continue;
      }

      const cells = parseMarkdownRow(trimmed);
      if (cells && cells.length >= 3) {
        apiEndpoints.push({
          group: currentApiGroup,
          method: cells[0] ?? "",
          endpoint: stripCodeCell(cells[1] ?? ""),
          description: cells[2] ?? "",
        });
      }
    }
  }

  return { frontendPages, apiEndpoints };
}

export function parseFeatureTree(repoRoot: string): FeatureTree {
  const raw = readFeatureTreeContent(repoRoot);
  const frontmatter = extractFrontmatter(raw);
  if (!frontmatter) {
    throw new Error("FEATURE_TREE.md frontmatter not found");
  }

  const parsed = yaml.load(frontmatter) as FeatureTreeFrontmatter | null;
  const featureMetadata = parsed?.feature_metadata;
  if (!featureMetadata) {
    throw new Error("feature_metadata not found in frontmatter");
  }

  const { frontendPages, apiEndpoints } = parseFeatureTreeTables(raw);

  return {
    capabilityGroups: (featureMetadata.capability_groups ?? []).map((group) => ({
      id: group.id ?? "",
      name: group.name ?? "",
      description: group.description ?? "",
    })),
    features: (featureMetadata.features ?? []).map((feature) => ({
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
    })),
    frontendPages,
    apiEndpoints,
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
  }

  if (links.length === 0) {
    for (const sourceFile of feature.sourceFiles) {
      const key = `${feature.id}|${sourceFile}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      links.push({
        featureId: feature.id,
        featureName: feature.name,
        viaPath: sourceFile,
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
  if (typeof map.command === "string") {
    return map.command;
  }

  if (typeof map.cmd === "string") {
    return map.cmd;
  }

  if (typeof map.tool_input === "object" && map.tool_input !== null) {
    const toolInput = map.tool_input as Record<string, unknown>;
    if (typeof toolInput.command === "string") {
      return toolInput.command;
    }
  }

  return undefined;
}

function normalizeRepoRelative(repoRoot: string, candidate: string): string | null {
  const cleaned = toPosix(candidate).trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

  if (!cleaned || cleaned === "/dev/null") {
    return null;
  }

  const absolute = path.isAbsolute(cleaned) ? cleaned : path.join(repoRoot, cleaned);
  const relative = path.relative(repoRoot, absolute);
  const relativePosix = toPosix(relative);

  if (!relativePosix || relativePosix.startsWith("../") || path.isAbsolute(relativePosix)) {
    return null;
  }

  return relativePosix;
}

function collectChangedFilesFromToolLike(event: unknown, repoRoot: string): string[] {
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

  const changed: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeRepoRelative(repoRoot, candidate);
    if (normalized) {
      changed.push(normalized);
    }
  }

  return changed;
}

function findTranscriptPaths(): string[] {
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
  const collected: string[] = [];

  while (queue.length > 0 && collected.length < MAX_TRANSCRIPT_FILES) {
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
        collected.push(current);
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

  return collected.sort((left, right) => {
    try {
      return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
    } catch {
      return 0;
    }
  });
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

export function collectFeatureSessionStats(repoRoot: string, featureTree: FeatureTree): FeatureStats {
  const featureStats: Record<string, FeatureTreeSummary> = {};
  const fileStats: Record<string, FileStat> = {};

  const featureSessionIds = new Map<string, Set<string>>();
  const featureChangedFiles = new Map<string, Set<string>>();
  const featureUpdatedAt = new Map<string, string>();

  const surfaceCatalog = parseFeatureSurfaceCatalog(repoRoot);
  const transcriptPaths = findTranscriptPaths();

  for (const transcriptPath of transcriptPaths) {
    let content: string;
    try {
      content = fs.readFileSync(transcriptPath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/).filter(Boolean);
    const payloads: unknown[] = [];

    if (transcriptPath.endsWith(".jsonl")) {
      for (const line of lines) {
        try {
          payloads.push(JSON.parse(line));
        } catch {
          continue;
        }
      }
    } else {
      try {
        payloads.push(JSON.parse(content));
      } catch {
        for (const line of lines) {
          try {
            payloads.push(JSON.parse(line));
          } catch {
            continue;
          }
        }
      }
    }

    for (const payload of payloads) {
      if (!payload || typeof payload !== "object") {
        continue;
      }

      const map = payload as Record<string, unknown>;
      const sessionId =
        (typeof map.session_id === "string" && map.session_id)
        || (typeof map.sessionId === "string" && map.sessionId)
        || path.basename(transcriptPath);
      const updatedAt = parseTranscriptUpdatedAt(map);

      const changedFromTranscript = new Set<string>();
      const sessionFeatures = new Set<string>();
      const featureMatchedFiles = new Map<string, Set<string>>();

      const events = extractEventsFromTranscript(payload);
      for (const event of events) {
        for (const changed of collectChangedFilesFromToolLike(event, repoRoot)) {
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
        if (!fileEntry.updatedAt || (updatedAt && updatedAt > fileEntry.updatedAt)) {
          fileEntry.updatedAt = updatedAt;
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
        sessions.add(sessionId);
        featureSessionIds.set(featureId, sessions);

        const changedFiles = featureChangedFiles.get(featureId) ?? new Set<string>();
        for (const changedFile of featureMatchedFiles.get(featureId) ?? changedFromTranscript) {
          changedFiles.add(changedFile);
        }
        featureChangedFiles.set(featureId, changedFiles);

        const currentUpdatedAt = featureUpdatedAt.get(featureId) ?? "";
        if (!currentUpdatedAt || (updatedAt && updatedAt > currentUpdatedAt)) {
          featureUpdatedAt.set(featureId, updatedAt);
        }
      }
    }
  }

  for (const [featureId, sessions] of featureSessionIds.entries()) {
    featureStats[featureId] = {
      sessionCount: sessions.size,
      changedFiles: featureChangedFiles.get(featureId)?.size ?? 0,
      updatedAt: featureUpdatedAt.get(featureId) ?? "",
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
