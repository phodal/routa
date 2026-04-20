/**
 * Feature tree generation orchestrator.
 *
 * Extracts the deterministic generation logic from the CLI script into
 * a reusable module that can be called from API routes, CLI, or UI.
 * This module performs file-system scanning (frontend routes, API
 * contracts, implementation routes) and produces FEATURE_TREE.md +
 * feature-tree.index.json.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";

// ── Types ───────────────────────────────────────────────────────────

type RouteInfo = {
  route: string;
  title: string;
  description: string;
  sourceFile: string;
};

type ContractApiFeature = {
  path: string;
  method: string;
  operationId: string;
  summary: string;
  domain: string;
};

type ImplementationApiRoute = {
  path: string;
  method: string;
  domain: string;
  sourceFiles: string[];
};

type FeatureMetadataGroup = {
  id: string;
  name: string;
  description?: string;
};

type FeatureMetadataItem = {
  id: string;
  name: string;
  group?: string;
  summary?: string;
  pages?: string[];
  apis?: string[];
  domainObjects?: string[];
  relatedFeatures?: string[];
  sourceFiles?: string[];
  screenshots?: string[];
  status?: string;
};

export type FeatureTreeMetadata = {
  schemaVersion: number;
  capabilityGroups: FeatureMetadataGroup[];
  features: FeatureMetadataItem[];
};

type FeatureSurfaceIndex = {
  generatedAt: string;
  pages: Array<{ route: string; title: string; description: string; sourceFile: string }>;
  apis: Array<{ domain: string; method: string; path: string; operationId: string; summary: string }>;
  contractApis: Array<{ domain: string; method: string; path: string; operationId: string; summary: string }>;
  nextjsApis: Array<{ domain: string; method: string; path: string; sourceFiles: string[] }>;
  rustApis: Array<{ domain: string; method: string; path: string; sourceFiles: string[] }>;
  implementationApis: Array<{ label: string; domain: string; method: string; path: string; sourceFiles: string[] }>;
  metadata: FeatureTreeMetadata | null;
};

type FeatureNode = {
  id?: string;
  name: string;
  description?: string;
  route?: string;
  path?: string;
  count?: number;
  children?: FeatureNode[];
};

type FeatureTree = {
  name: string;
  description: string;
  children: FeatureNode[];
};

type OpenApiMethod = {
  operationId?: string;
  summary?: string;
};

type OpenApiDoc = {
  paths?: Record<string, Record<string, OpenApiMethod>>;
};

const IGNORED_PATHS = new Set([".git", "node_modules", ".next", "dist", "out", "target"]);
const PREFLIGHT_CACHE_TTL_MS = 30_000;
const preflightCache = new Map<string, { expiresAt: number; result: FeatureTreePreflightResult }>();

export type GenerateFeatureTreeOptions = {
  repoRoot: string;
  scanRoot?: string;
  metadata?: FeatureTreeMetadata | null;
  dryRun?: boolean;
};

export type GenerateFeatureTreeResult = {
  generatedAt: string;
  frameworksDetected: string[];
  wroteFiles: string[];
  warnings: string[];
  pagesCount: number;
  apisCount: number;
};

export type FeatureTreeAdapterId =
  | "nextjs-app-router"
  | "nextjs-pages-api"
  | "axum"
  | "spring-boot"
  | "eggjs";

export type FeatureTreeCandidateRoot = {
  path: string;
  kind: "root" | "workspace" | "package" | "app";
  score: number;
  surfaceCounts: {
    pages: number;
    appRouterApis: number;
    pagesApis: number;
    rustApis: number;
  };
  adapters: FeatureTreeAdapterId[];
  warnings: string[];
};

export type FeatureTreePreflightResult = {
  repoRoot: string;
  selectedScanRoot: string;
  frameworksDetected: string[];
  adapters: Array<{
    id: FeatureTreeAdapterId;
    confidence: "high" | "medium";
    signals: string[];
  }>;
  candidateRoots: FeatureTreeCandidateRoot[];
  warnings: string[];
};

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueSorted(value.map((item) => normalizeString(item)).filter(Boolean));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isSameOrDescendant(parentPath: string, targetPath: string): boolean {
  const resolvedParent = path.resolve(parentPath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedParent || resolvedTarget.startsWith(`${resolvedParent}${path.sep}`);
}

function toRepoRelative(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function domainFromApiPath(apiPath: string): string {
  const match = apiPath.match(/^\/api\/([^/]+)/);
  return match?.[1] ?? "root";
}

function normalizeApiPathSegment(segment: string): string {
  if (!segment.startsWith("[") || !segment.endsWith("]")) return segment;
  if (segment.startsWith("[...") && segment.endsWith("]")) return `{${segment.slice(4, -1)}}`;
  return `{${segment.slice(1, -1)}}`;
}

function normalizeNextjsApiPath(relativeDir: string): string {
  const normalized = relativeDir === "." ? "" : relativeDir.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean).map(normalizeApiPathSegment);
  return segments.length > 0 ? `/api/${segments.join("/")}` : "/api";
}

function formatRouteSegment(segment: string): string {
  let normalized = segment.trim();
  if (!normalized) return "";
  if (normalized.startsWith(":")) normalized = normalized.slice(1);
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const inner = normalized.slice(1, -1).replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    return inner.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return normalized.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePagesRouteSegment(segment: string): string {
  if (segment.startsWith("[[...") && segment.endsWith("]]")) {
    return `:${segment.slice(5, -2)}`;
  }
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `:${segment.slice(4, -1)}`;
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return `:${segment.slice(1, -1)}`;
  }
  return segment;
}

function normalizePagesRoute(relativeFile: string): string {
  const withoutExt = relativeFile.replace(/\.(tsx?|jsx?)$/u, "");
  const normalized = withoutExt
    .replace(/\\/g, "/")
    .replace(/^index$/u, "")
    .replace(/\/index$/u, "")
    .split("/")
    .filter(Boolean)
    .map(normalizePagesRouteSegment)
    .join("/");
  return normalized ? `/${normalized}` : "/";
}

function parsePageComment(content: string): { title: string | null; description: string | null } {
  const match = content.match(/\/\*\*\s*(.*?)\s*\*\//s);
  if (!match) return { title: null, description: null };
  const lines = match[1].split("\n").map((line) => line.trim().replace(/^\*\s?/, "")).filter(Boolean);
  if (lines.length === 0) return { title: null, description: null };
  const titleLine = lines[0];
  const titleMatch = titleLine.match(/^(.+?)\s*[-—]\s*\/.*$/);
  const title = titleMatch ? titleMatch[1].trim() : titleLine;
  const description = lines.slice(1).join(" ").replace(/\s+/g, " ").trim().slice(0, 100);
  return { title, description: description || null };
}

// ── Metadata parsing ────────────────────────────────────────────────

function normalizeFeatureMetadata(input: unknown): FeatureTreeMetadata | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const schemaVersion = Number(raw.schemaVersion ?? raw.schema_version);
  const rawCapabilityGroups = raw.capabilityGroups ?? raw.capability_groups;
  const capabilityGroups = Array.isArray(rawCapabilityGroups)
    ? rawCapabilityGroups.map((group: unknown): FeatureMetadataGroup | null => {
      if (!group || typeof group !== "object") return null;
      const id = normalizeString((group as Record<string, unknown>).id);
      const name = normalizeString((group as Record<string, unknown>).name);
      if (!id || !name) return null;
      const description = normalizeString((group as Record<string, unknown>).description);
      return { id, name, ...(description ? { description } : {}) };
    }).filter((g): g is FeatureMetadataGroup => Boolean(g))
    : [];
  const features = Array.isArray(raw.features)
    ? raw.features.map((feature: unknown): FeatureMetadataItem | null => {
      if (!feature || typeof feature !== "object") return null;
      const f = feature as Record<string, unknown>;
      const id = normalizeString(f.id);
      const name = normalizeString(f.name);
      if (!id || !name) return null;
      return {
        id, name,
        ...(normalizeString(f.group) ? { group: normalizeString(f.group) } : {}),
        ...(normalizeString(f.summary) ? { summary: normalizeString(f.summary) } : {}),
        ...(normalizeString(f.status) ? { status: normalizeString(f.status) } : {}),
        ...(normalizeStringArray(f.pages).length ? { pages: normalizeStringArray(f.pages) } : {}),
        ...(normalizeStringArray(f.apis).length ? { apis: normalizeStringArray(f.apis) } : {}),
        ...(normalizeStringArray(f.domainObjects ?? f.domain_objects).length ? { domainObjects: normalizeStringArray(f.domainObjects ?? f.domain_objects) } : {}),
        ...(normalizeStringArray(f.relatedFeatures ?? f.related_features).length ? { relatedFeatures: normalizeStringArray(f.relatedFeatures ?? f.related_features) } : {}),
        ...(normalizeStringArray(f.sourceFiles ?? f.source_files).length ? { sourceFiles: normalizeStringArray(f.sourceFiles ?? f.source_files) } : {}),
        ...(normalizeStringArray(f.screenshots).length ? { screenshots: normalizeStringArray(f.screenshots) } : {}),
      };
    }).filter((f): f is FeatureMetadataItem => Boolean(f))
    : [];
  return { schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1, capabilityGroups, features };
}

function readFeatureMetadataFromMarkdown(markdown: string): FeatureTreeMetadata | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = yaml.load(match[1]); } catch { return null; }
  const featureMetadata = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).feature_metadata : null;
  return normalizeFeatureMetadata(featureMetadata);
}

function readFeatureMetadataFromJson(raw: string): FeatureTreeMetadata | null {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const metadata = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).metadata : null;
  return normalizeFeatureMetadata(metadata);
}

function readTrackedFileFromHead(repoRoot: string, relativePath: string): string {
  try {
    return execFileSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch { return ""; }
}

function loadPersistedFeatureMetadata(repoRoot: string, mdPath: string, jsonPath: string): FeatureTreeMetadata | null {
  const existingMd = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf8") : "";
  const existingJson = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : "";
  return readFeatureMetadataFromMarkdown(existingMd)
    ?? readFeatureMetadataFromJson(existingJson)
    ?? readFeatureMetadataFromMarkdown(readTrackedFileFromHead(repoRoot, "docs/product-specs/FEATURE_TREE.md"));
}

// ── Scanning ────────────────────────────────────────────────────────

function scanFrontendRoutes(repoRoot: string, scanRoot: string): RouteInfo[] {
  const appDirs = [
    path.join(scanRoot, "src", "app"),
    path.join(scanRoot, "app"),
  ];
  const pagesDirs = [
    path.join(scanRoot, "src", "pages"),
    path.join(scanRoot, "pages"),
  ];
  const routes: RouteInfo[] = [];
  const pageFileNames = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"]);
  const pagesRouterSpecialFiles = new Set(["_app", "_document", "_error", "_middleware"]);

  function recordRoute(route: string, sourceFilePath: string, content: string, titleSegments: string[]): void {
    const parsed = parsePageComment(content);
    let title = parsed.title?.trim();
    if (!title) {
      if (route === "/") { title = "Home"; }
      else {
        const staticSegments = titleSegments
          .filter((segment) => !(segment.startsWith("[") && segment.endsWith("]")))
          .map(formatRouteSegment)
          .filter(Boolean);
        title = staticSegments.slice(-2).join(" / ").trim()
          || formatRouteSegment(titleSegments.at(-1) ?? "")
          || "Page";
      }
    }

    routes.push({
      route,
      title,
      description: parsed.description ?? "",
      sourceFile: toRepoRelative(repoRoot, sourceFilePath),
    });
  }

  function walkAppRouter(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walkAppRouter(fullPath); continue; }
      if (!pageFileNames.has(entry.name)) continue;
      if (fullPath.includes(`${path.sep}api${path.sep}`)) continue;

      const appDir = appDirs.find((candidate) => isSameOrDescendant(candidate, fullPath)) ?? scanRoot;
      const relDir = path.relative(appDir, path.dirname(fullPath));
      let route = `/${relDir.replace(/\\/g, "/")}`;
      if (route === "/" || route === "/.") route = "/";
      route = route.replace(/\[([^\]]+)\]/g, ":$1");
      recordRoute(route, fullPath, fs.readFileSync(fullPath, "utf8"), relDir.split(path.sep).filter(Boolean));
    }
  }

  function walkPagesRouter(dir: string, pagesDir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "api") continue;
        walkPagesRouter(fullPath, pagesDir);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/u.test(entry.name)) continue;

      const relativeFile = path.relative(pagesDir, fullPath).replace(/\\/g, "/");
      const baseName = path.basename(relativeFile).replace(/\.(tsx?|jsx?)$/u, "");
      if (pagesRouterSpecialFiles.has(baseName)) continue;

      const titleSegments = relativeFile
        .replace(/\.(tsx?|jsx?)$/u, "")
        .replace(/\/index$/u, "")
        .split("/")
        .filter(Boolean);
      recordRoute(
        normalizePagesRoute(relativeFile),
        fullPath,
        fs.readFileSync(fullPath, "utf8"),
        titleSegments,
      );
    }
  }

  for (const appDir of appDirs) {
    walkAppRouter(appDir);
  }
  for (const pagesDir of pagesDirs) {
    walkPagesRouter(pagesDir, pagesDir);
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

function scanNextjsAppRouterApiRoutes(repoRoot: string, scanRoot: string): ImplementationApiRoute[] {
  const nextApiDirs = [
    path.join(scanRoot, "src", "app", "api"),
    path.join(scanRoot, "app", "api"),
  ];
  const routes = new Map<string, ImplementationApiRoute>();
  const exportedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

  function walk(dir: string, nextApiDir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath, nextApiDir); continue; }
      if (entry.name !== "route.ts" && entry.name !== "route.js") continue;

      const relativeDir = path.relative(nextApiDir, path.dirname(fullPath));
      const routePath = normalizeNextjsApiPath(relativeDir);
      const content = fs.readFileSync(fullPath, "utf8");
      const sourceFile = toRepoRelative(repoRoot, fullPath);

      for (const method of exportedMethods) {
        const regex = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b|export\\s*\\{[^}]*\\b${method}\\b`);
        if (!regex.test(content)) continue;
        const key = `${method} ${routePath}`;
        routes.set(key, { method, path: routePath, domain: domainFromApiPath(routePath), sourceFiles: [sourceFile] });
      }
    }
  }

  for (const nextApiDir of nextApiDirs) {
    walk(nextApiDir, nextApiDir);
  }
  return [...routes.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function normalizePagesApiPath(relativeFile: string): string {
  const withoutExt = relativeFile.replace(/\.(tsx?|jsx?)$/, "");
  const normalized = withoutExt
    .replace(/\\/g, "/")
    .replace(/\/index$/, "")
    .split("/")
    .filter(Boolean)
    .map(normalizeApiPathSegment)
    .join("/");
  return normalized ? `/api/${normalized}` : "/api";
}

function detectPagesApiMethods(content: string): string[] {
  const explicitMatches = [...content.matchAll(/req\.method\s*(?:===|==)\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`]/g)]
    .map((match) => (match[1] ?? "").toUpperCase())
    .filter(Boolean);
  if (explicitMatches.length > 0) {
    return uniqueSorted(explicitMatches);
  }

  const switchMatches = [...content.matchAll(/case\s+["'`](GET|POST|PUT|DELETE|PATCH)["'`]/g)]
    .map((match) => (match[1] ?? "").toUpperCase())
    .filter(Boolean);
  if (switchMatches.length > 0) {
    return uniqueSorted(switchMatches);
  }

  if (/export\s+default\b|module\.exports\s*=|NextApiHandler/u.test(content)) {
    return ["GET"];
  }

  return [];
}

function scanNextjsPagesApiRoutes(repoRoot: string, scanRoot: string): ImplementationApiRoute[] {
  const pagesApiDirs = [
    path.join(scanRoot, "src", "pages", "api"),
    path.join(scanRoot, "pages", "api"),
  ];
  const routes = new Map<string, ImplementationApiRoute>();

  function walk(dir: string, pagesApiDir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, pagesApiDir);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/u.test(entry.name)) continue;

      const relativeFile = path.relative(pagesApiDir, fullPath);
      const routePath = normalizePagesApiPath(relativeFile);
      const content = fs.readFileSync(fullPath, "utf8");
      const sourceFile = toRepoRelative(repoRoot, fullPath);

      for (const method of detectPagesApiMethods(content)) {
        const key = `${method} ${routePath}`;
        routes.set(key, {
          method,
          path: routePath,
          domain: domainFromApiPath(routePath),
          sourceFiles: [sourceFile],
        });
      }
    }
  }

  for (const pagesApiDir of pagesApiDirs) {
    walk(pagesApiDir, pagesApiDir);
  }

  return [...routes.values()].sort((a, b) =>
    a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function extractMethods(handlerChain: string): string[] {
  const methods: string[] = [];
  for (const method of ["get", "post", "put", "delete", "patch"]) {
    if (new RegExp(`(?:^|[\\s.:])${method}\\(`).test(handlerChain)) methods.push(method.toUpperCase());
  }
  return methods;
}

function extractRouteCalls(content: string): Array<{ subPath: string; handlerChain: string }> {
  const results: Array<{ subPath: string; handlerChain: string }> = [];
  const prefix = ".route(";
  let index = 0;

  while (index < content.length) {
    const routeIndex = content.indexOf(prefix, index);
    if (routeIndex === -1) break;
    let cursor = routeIndex + prefix.length;
    while (cursor < content.length && /\s/.test(content[cursor] ?? "")) cursor += 1;
    if (content[cursor] !== "\"") { index = cursor + 1; continue; }
    cursor += 1;
    let subPath = "";
    while (cursor < content.length && content[cursor] !== "\"") { subPath += content[cursor]; cursor += 1; }
    cursor += 1;
    while (cursor < content.length && /[\s,]/.test(content[cursor] ?? "")) cursor += 1;
    let depth = 1;
    const handlerStart = cursor;
    while (cursor < content.length && depth > 0) {
      if (content[cursor] === "(") depth += 1;
      else if (content[cursor] === ")") depth -= 1;
      if (depth > 0) cursor += 1;
    }
    results.push({ subPath, handlerChain: content.slice(handlerStart, cursor) });
    index = cursor + 1;
  }
  return results;
}

function extractNestCalls(content: string): Array<{ basePath: string; modulePath: string; functionName: string }> {
  const results: Array<{ basePath: string; modulePath: string; functionName: string }> = [];
  const regex = /\.nest\("([^"]+)",\s*([\w:]+)::(\w+)\([^)]*\)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    results.push({ basePath: match[1] ?? "", modulePath: match[2] ?? "", functionName: match[3] ?? "" });
  }
  return results;
}

function joinRustRoutePaths(basePath: string, subPath: string): string {
  const normalizedBase = basePath.replace(/\/+$/, "");
  const normalizedSubPath = subPath === "/" ? "" : subPath;
  return `${normalizedBase}${normalizedSubPath || ""}` || "/";
}

function listRustSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRustSourceFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".rs")) files.push(fullPath);
  }
  return files.sort();
}

function readRustApiModule(repoRoot: string, moduleName: string): { content: string; sourceFiles: string[] } | null {
  const rustApiDir = path.join(repoRoot, "crates", "routa-server", "src", "api");
  const moduleFile = path.join(rustApiDir, `${moduleName}.rs`);
  const moduleDir = path.join(rustApiDir, moduleName);
  const files: string[] = [];
  if (fs.existsSync(moduleFile)) files.push(moduleFile);
  files.push(...listRustSourceFiles(moduleDir));
  if (files.length === 0) return null;
  return { content: files.map((f) => fs.readFileSync(f, "utf8")).join("\n"), sourceFiles: files.map((f) => toRepoRelative(repoRoot, f)) };
}

function recordImplementationApiRoute(
  routes: Map<string, ImplementationApiRoute>,
  route: Omit<ImplementationApiRoute, "domain"> & { domain?: string },
): void {
  const key = `${route.method} ${route.path}`;
  const existing = routes.get(key);
  const sourceFiles = [...new Set(route.sourceFiles)].sort();
  if (!existing) {
    routes.set(key, { method: route.method, path: route.path, domain: route.domain ?? domainFromApiPath(route.path), sourceFiles });
    return;
  }
  routes.set(key, { ...existing, sourceFiles: [...new Set([...existing.sourceFiles, ...sourceFiles])].sort() });
}

function collectRustApiRoutes(params: {
  repoRoot: string; content: string; basePath: string; sourceFiles: string[];
  visitedRouters: Set<string>; routes: Map<string, ImplementationApiRoute>;
}): void {
  const { repoRoot, content, basePath, sourceFiles, visitedRouters, routes } = params;
  for (const { subPath, handlerChain } of extractRouteCalls(content)) {
    const fullPath = joinRustRoutePaths(basePath, subPath);
    for (const method of extractMethods(handlerChain)) {
      recordImplementationApiRoute(routes, { method, path: fullPath, sourceFiles });
    }
  }
  for (const nest of extractNestCalls(content)) {
    const moduleName = nest.modulePath.split("::").filter(Boolean).at(-1);
    if (!moduleName) continue;
    const visitKey = `${basePath}::${nest.basePath}::${nest.modulePath}::${nest.functionName}`;
    if (visitedRouters.has(visitKey)) continue;
    visitedRouters.add(visitKey);
    const apiModule = readRustApiModule(repoRoot, moduleName);
    if (!apiModule) continue;
    collectRustApiRoutes({ repoRoot, content: apiModule.content, basePath: joinRustRoutePaths(basePath, nest.basePath), sourceFiles: apiModule.sourceFiles, visitedRouters, routes });
  }
}

function scanRustApiRoutes(repoRoot: string, scanRoot: string): ImplementationApiRoute[] {
  const rustApiDir = path.join(scanRoot, "crates", "routa-server", "src", "api");
  const rustApiMod = path.join(rustApiDir, "mod.rs");
  const rustLib = path.join(scanRoot, "crates", "routa-server", "src", "lib.rs");
  const routes = new Map<string, ImplementationApiRoute>();
  const visitedRouters = new Set<string>();

  if (fs.existsSync(rustApiMod)) {
    collectRustApiRoutes({ repoRoot, content: fs.readFileSync(rustApiMod, "utf8"), basePath: "", sourceFiles: [toRepoRelative(repoRoot, rustApiMod)], visitedRouters, routes });
  }
  for (const directFile of [rustApiMod, rustLib]) {
    if (!fs.existsSync(directFile)) continue;
    const content = fs.readFileSync(directFile, "utf8");
    for (const { subPath, handlerChain } of extractRouteCalls(content)) {
      if (!subPath.startsWith("/api/")) continue;
      for (const method of extractMethods(handlerChain)) {
        recordImplementationApiRoute(routes, { method, path: subPath, sourceFiles: [toRepoRelative(repoRoot, directFile)] });
      }
    }
  }
  return [...routes.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// ── API contract loading ────────────────────────────────────────────

function loadApiContract(repoRoot: string, scanRoot: string): OpenApiDoc | null {
  const candidatePaths = uniqueSorted([
    path.join(scanRoot, "api-contract.yaml"),
    path.join(repoRoot, "api-contract.yaml"),
  ]);

  for (const contractPath of candidatePaths) {
    if (!fs.existsSync(contractPath)) continue;
    try {
      return yaml.load(fs.readFileSync(contractPath, "utf8")) as OpenApiDoc;
    } catch {
      return null;
    }
  }

  return null;
}

function extractApiFeatures(apiContract: OpenApiDoc | null): Record<string, ContractApiFeature[]> {
  if (!apiContract?.paths) return {};
  const domains = new Map<string, ContractApiFeature[]>();
  for (const [apiPath, methods] of Object.entries(apiContract.paths)) {
    const match = apiPath.match(/^\/api\/([^/]+)/);
    if (!match) continue;
    const domain = match[1];
    const domainFeatures = domains.get(domain) ?? [];
    for (const [method, spec] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      domainFeatures.push({ domain, path: apiPath, method: method.toUpperCase(), operationId: spec.operationId ?? "", summary: spec.summary ?? "" });
    }
    domains.set(domain, domainFeatures);
  }
  return Object.fromEntries([...domains.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// ── Surface index building ──────────────────────────────────────────

function flattenContractApis(apiFeatures: Record<string, ContractApiFeature[]>): ContractApiFeature[] {
  return Object.values(apiFeatures).flatMap((f) => f).sort((a, b) =>
    a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function buildFeatureSurfaceIndex(
  routes: RouteInfo[], apiFeatures: Record<string, ContractApiFeature[]>,
  nextjsApis: ImplementationApiRoute[], rustApis: ImplementationApiRoute[],
  implementationApis: Array<ImplementationApiRoute & { label: string }>,
  metadata: FeatureTreeMetadata | null = null,
): FeatureSurfaceIndex {
  const contractApis = flattenContractApis(apiFeatures).map((f) => ({
    domain: f.domain, method: f.method, path: f.path, operationId: f.operationId, summary: f.summary,
  }));
  return {
    generatedAt: new Date().toISOString(),
    pages: routes.map((r) => ({ route: r.route, title: r.title, description: r.description, sourceFile: r.sourceFile })),
    apis: contractApis,
    contractApis,
    nextjsApis: nextjsApis.map((a) => ({ domain: a.domain, method: a.method, path: a.path, sourceFiles: a.sourceFiles })),
    rustApis: rustApis.map((a) => ({ domain: a.domain, method: a.method, path: a.path, sourceFiles: a.sourceFiles })),
    implementationApis: implementationApis.map((a) => ({
      label: a.label,
      domain: a.domain,
      method: a.method,
      path: a.path,
      sourceFiles: a.sourceFiles,
    })),
    metadata,
  };
}

function detectFramework(repoRoot: string): string[] {
  const detected: string[] = [];
  if (
    fs.existsSync(path.join(repoRoot, "next.config.ts"))
    || fs.existsSync(path.join(repoRoot, "next.config.js"))
    || fs.existsSync(path.join(repoRoot, "src", "app"))
    || fs.existsSync(path.join(repoRoot, "app"))
    || fs.existsSync(path.join(repoRoot, "src", "pages"))
    || fs.existsSync(path.join(repoRoot, "pages"))
  ) {
    detected.push("nextjs");
  }
  if (fs.existsSync(path.join(repoRoot, "pom.xml"))) detected.push("spring-boot");
  if (fs.existsSync(path.join(repoRoot, "config", "plugin.ts")) || fs.existsSync(path.join(repoRoot, "config", "plugin.js"))) {
    detected.push("eggjs");
  }
  if (fs.existsSync(path.join(repoRoot, "Cargo.toml")) || fs.existsSync(path.join(repoRoot, "crates", "routa-server"))) {
    detected.push("rust");
  }
  if (detected.length === 0) detected.push("generic");
  return detected;
}

function validateScanRoot(repoRoot: string, scanRoot?: string): string {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const requestedScanRoot = path.resolve(scanRoot ?? repoRoot);
  if (!isSameOrDescendant(resolvedRepoRoot, requestedScanRoot)) {
    throw new Error(`scanRoot must be within repoRoot: ${requestedScanRoot}`);
  }
  if (!fs.existsSync(requestedScanRoot) || !fs.statSync(requestedScanRoot).isDirectory()) {
    throw new Error(`scanRoot does not exist: ${requestedScanRoot}`);
  }
  return requestedScanRoot;
}

function detectAdapters(repoRoot: string): Array<{ id: FeatureTreeAdapterId; confidence: "high" | "medium"; signals: string[] }> {
  const adapters: Array<{ id: FeatureTreeAdapterId; confidence: "high" | "medium"; signals: string[] }> = [];
  const hasAppRouter = fs.existsSync(path.join(repoRoot, "src", "app")) || fs.existsSync(path.join(repoRoot, "app"));
  if (hasAppRouter) {
    adapters.push({
      id: "nextjs-app-router",
      confidence: "high",
      signals: uniqueSorted([
        fs.existsSync(path.join(repoRoot, "src", "app")) ? "src/app" : "",
        fs.existsSync(path.join(repoRoot, "app")) ? "app" : "",
        fs.existsSync(path.join(repoRoot, "next.config.js")) ? "next.config.js" : "",
        fs.existsSync(path.join(repoRoot, "next.config.ts")) ? "next.config.ts" : "",
      ]),
    });
  }
  const hasPagesApi = fs.existsSync(path.join(repoRoot, "src", "pages", "api")) || fs.existsSync(path.join(repoRoot, "pages", "api"));
  if (hasPagesApi) {
    adapters.push({
      id: "nextjs-pages-api",
      confidence: "high",
      signals: uniqueSorted([
        fs.existsSync(path.join(repoRoot, "src", "pages", "api")) ? "src/pages/api" : "",
        fs.existsSync(path.join(repoRoot, "pages", "api")) ? "pages/api" : "",
      ]),
    });
  }
  const hasAxum = fs.existsSync(path.join(repoRoot, "crates", "routa-server", "src", "api")) || fs.existsSync(path.join(repoRoot, "Cargo.toml"));
  if (hasAxum) {
    adapters.push({
      id: "axum",
      confidence: fs.existsSync(path.join(repoRoot, "crates", "routa-server", "src", "api")) ? "high" : "medium",
      signals: uniqueSorted([
        fs.existsSync(path.join(repoRoot, "Cargo.toml")) ? "Cargo.toml" : "",
        fs.existsSync(path.join(repoRoot, "crates", "routa-server", "src", "api")) ? "crates/routa-server/src/api" : "",
      ]),
    });
  }
  if (fs.existsSync(path.join(repoRoot, "pom.xml"))) {
    adapters.push({ id: "spring-boot", confidence: "medium", signals: ["pom.xml"] });
  }
  if (fs.existsSync(path.join(repoRoot, "config", "plugin.ts")) || fs.existsSync(path.join(repoRoot, "config", "plugin.js"))) {
    adapters.push({ id: "eggjs", confidence: "medium", signals: ["config/plugin"] });
  }
  return adapters;
}

function candidateKindForRoot(repoRoot: string, candidateRoot: string): FeatureTreeCandidateRoot["kind"] {
  if (path.resolve(repoRoot) === path.resolve(candidateRoot)) {
    return "root";
  }
  if (
    fs.existsSync(path.join(candidateRoot, "src", "app"))
    || fs.existsSync(path.join(candidateRoot, "app"))
    || fs.existsSync(path.join(candidateRoot, "src", "pages"))
    || fs.existsSync(path.join(candidateRoot, "pages"))
  ) {
    return "app";
  }
  if (fs.existsSync(path.join(candidateRoot, "package.json"))) {
    return "package";
  }
  return "workspace";
}

function collectCandidateRoots(repoRoot: string): string[] {
  const candidates = new Set<string>([path.resolve(repoRoot)]);
  const maxDepth = 4;

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || !fs.existsSync(dir)) return;
    const dirName = path.basename(dir);
    if (depth > 0 && (IGNORED_PATHS.has(dirName) || dirName.startsWith("."))) return;

    const hasRootSignal = [
      "package.json",
      "Cargo.toml",
      "pom.xml",
      "next.config.js",
      "next.config.ts",
    ].some((entry) => fs.existsSync(path.join(dir, entry)));
    const hasSurfaceSignal = [
      path.join(dir, "src", "app"),
      path.join(dir, "app"),
      path.join(dir, "src", "pages"),
      path.join(dir, "pages"),
      path.join(dir, "src", "pages", "api"),
      path.join(dir, "pages", "api"),
      path.join(dir, "crates", "routa-server", "src", "api"),
    ].some((entry) => fs.existsSync(entry));

    if (hasRootSignal || hasSurfaceSignal) {
      candidates.add(path.resolve(dir));
    }

    if (depth === maxDepth) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_PATHS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(repoRoot, 0);

  return [...candidates].sort((left, right) => left.length - right.length || left.localeCompare(right));
}

function buildCandidateRoot(repoRoot: string, candidateRoot: string): FeatureTreeCandidateRoot {
  const pages = scanFrontendRoutes(repoRoot, candidateRoot);
  const appRouterApis = scanNextjsAppRouterApiRoutes(repoRoot, candidateRoot);
  const pagesApis = scanNextjsPagesApiRoutes(repoRoot, candidateRoot);
  const rustApis = scanRustApiRoutes(repoRoot, candidateRoot);
  const adapters = detectAdapters(candidateRoot).map((entry) => entry.id);
  const warnings: string[] = [];
  if (!loadApiContract(repoRoot, candidateRoot)) {
    warnings.push("No api-contract.yaml found for selected root; using implementation-only API discovery.");
  }
  const score = (pages.length * 10)
    + ((appRouterApis.length + pagesApis.length + rustApis.length) * 12)
    + (adapters.length * 25)
    - Math.max(path.relative(repoRoot, candidateRoot).split(path.sep).filter(Boolean).length - 1, 0);

  return {
    path: candidateRoot,
    kind: candidateKindForRoot(repoRoot, candidateRoot),
    score,
    surfaceCounts: {
      pages: pages.length,
      appRouterApis: appRouterApis.length,
      pagesApis: pagesApis.length,
      rustApis: rustApis.length,
    },
    adapters,
    warnings,
  };
}

export function preflightFeatureTree(repoRoot: string): FeatureTreePreflightResult {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const cached = preflightCache.get(resolvedRepoRoot);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const candidateRoots = collectCandidateRoots(resolvedRepoRoot).map((candidateRoot) =>
    buildCandidateRoot(resolvedRepoRoot, candidateRoot));
  const selectedCandidate = [...candidateRoots].sort((left, right) =>
    right.score - left.score || left.path.localeCompare(right.path))[0];
  const selectedScanRoot = selectedCandidate?.path ?? resolvedRepoRoot;
  const warnings = uniqueSorted([
    ...candidateRoots.flatMap((candidate) => candidate.warnings),
    selectedCandidate && selectedCandidate.path !== resolvedRepoRoot
      ? `Selected nested scan root ${path.relative(resolvedRepoRoot, selectedCandidate.path) || "."} based on detected product surface.`
      : "",
  ]);

  const result = {
    repoRoot: resolvedRepoRoot,
    selectedScanRoot,
    frameworksDetected: detectFramework(selectedScanRoot),
    adapters: detectAdapters(selectedScanRoot),
    candidateRoots: [...candidateRoots].sort((left, right) =>
      right.score - left.score || left.path.localeCompare(right.path)),
    warnings,
  };

  preflightCache.set(resolvedRepoRoot, {
    expiresAt: Date.now() + PREFLIGHT_CACHE_TTL_MS,
    result,
  });

  return result;
}

// ── Markdown rendering ──────────────────────────────────────────────

function buildApiLookupKey(method: string, apiPath: string): string {
  return `${method.trim().toUpperCase()} ${apiPath.trim().replace(/\{[^}]+\}/g, "{}").replace(/:[^/]+/g, "{}")}`;
}

function formatSourceFiles(sourceFiles: string[]): string {
  if (sourceFiles.length === 0) return "";
  return sourceFiles.map((f) => `\`${f}\``).join(", ");
}

function buildFrontmatterMetadata(metadata: FeatureTreeMetadata, surfaceIndex: FeatureSurfaceIndex): string {
  const preferredApiDeclarations = new Map<string, string>();
  for (const api of surfaceIndex.contractApis) {
    preferredApiDeclarations.set(buildApiLookupKey(api.method, api.path), `${api.method} ${api.path}`);
  }
  for (const api of [...surfaceIndex.nextjsApis, ...surfaceIndex.rustApis]) {
    const key = buildApiLookupKey(api.method, api.path);
    if (!preferredApiDeclarations.has(key)) preferredApiDeclarations.set(key, `${api.method} ${api.path}`);
  }

  const persistedMetadata = {
    schemaVersion: metadata.schemaVersion,
    capabilityGroups: metadata.capabilityGroups,
    features: metadata.features.map((feature) => {
      if (!feature.apis?.length) return feature;
      const sanitized = new Map<string, string>();
      for (const declaration of feature.apis) {
        const [method = "GET", endpointPath = declaration.trim()] = declaration.trim().split(/\s+/, 2);
        const key = buildApiLookupKey(method, endpointPath);
        sanitized.set(key, preferredApiDeclarations.get(key) ?? declaration.trim());
      }
      return { ...feature, apis: [...sanitized.values()].sort() };
    }),
  };

  return yaml.dump({
    feature_metadata: {
      schema_version: persistedMetadata.schemaVersion,
      capability_groups: persistedMetadata.capabilityGroups.map((g) => ({
        id: g.id, name: g.name, ...(g.description ? { description: g.description } : {}),
      })),
      features: persistedMetadata.features.map((f) => ({
        id: f.id, name: f.name,
        ...(f.group ? { group: f.group } : {}),
        ...(f.summary ? { summary: f.summary } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.pages?.length ? { pages: f.pages } : {}),
        ...(f.apis?.length ? { apis: f.apis } : {}),
        ...(f.domainObjects?.length ? { domain_objects: f.domainObjects } : {}),
        ...(f.relatedFeatures?.length ? { related_features: f.relatedFeatures } : {}),
        ...(f.sourceFiles?.length ? { source_files: f.sourceFiles } : {}),
        ...(f.screenshots?.length ? { screenshots: f.screenshots } : {}),
      })),
    },
  }).trimEnd();
}

function renderContractApiSection(
  lines: string[],
  apis: FeatureSurfaceIndex["contractApis"],
  nextjsApis: ImplementationApiRoute[],
  rustApis: ImplementationApiRoute[],
): void {
  const grouped = new Map<string, typeof apis>();
  const nextjsLookup = new Map(nextjsApis.map((a) => [buildApiLookupKey(a.method, a.path), a.sourceFiles]));
  const rustLookup = new Map(rustApis.map((a) => [buildApiLookupKey(a.method, a.path), a.sourceFiles]));
  for (const api of apis) {
    const current = grouped.get(api.domain) ?? [];
    current.push(api);
    grouped.set(api.domain, current);
  }
  lines.push("## API Contract Endpoints", "");
  for (const [domain, endpoints] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const domainName = domain.replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`### ${domainName} (${endpoints.length})`, "");
    lines.push("| Method | Endpoint | Details | Next.js | Rust |", "|--------|----------|---------|---------|------|");
    for (const ep of endpoints) {
      const key = buildApiLookupKey(ep.method, ep.path);
      lines.push(`| ${ep.method} | \`${ep.path}\` | ${ep.summary || ep.operationId || ""} | ${formatSourceFiles(nextjsLookup.get(key) ?? [])} | ${formatSourceFiles(rustLookup.get(key) ?? [])} |`);
    }
    lines.push("");
  }
}

function filterImplementationOnlyApis(
  contractApis: FeatureSurfaceIndex["contractApis"],
  implementationApis: ImplementationApiRoute[],
): ImplementationApiRoute[] {
  const contractKeys = new Set(contractApis.map((a) => buildApiLookupKey(a.method, a.path)));
  return implementationApis.filter((a) => !contractKeys.has(buildApiLookupKey(a.method, a.path)));
}

function renderImplementationOnlyApiSection(lines: string[], title: string, apis: ImplementationApiRoute[]): void {
  if (apis.length === 0) return;
  const grouped = new Map<string, ImplementationApiRoute[]>();
  for (const api of apis) {
    const current = grouped.get(api.domain) ?? [];
    current.push(api);
    grouped.set(api.domain, current);
  }
  lines.push("---", "", title, "");
  for (const [domain, endpoints] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const domainName = domain.replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`### ${domainName} (${endpoints.length})`, "");
    lines.push("| Method | Endpoint | Source Files |", "|--------|----------|--------------|");
    for (const ep of endpoints) {
      lines.push(`| ${ep.method} | \`${ep.path}\` | ${formatSourceFiles(ep.sourceFiles)} |`);
    }
    lines.push("");
  }
}

function renderMarkdown(tree: FeatureTree, surfaceIndex: FeatureSurfaceIndex, nextjsApis: ImplementationApiRoute[], rustApis: ImplementationApiRoute[]): string {
  const lines: string[] = [
    "---",
    "status: generated",
    "purpose: Auto-generated route and API surface index for Routa.js.",
    "sources:",
    "  - src/app/**/page.tsx",
    "  - app/**/page.tsx",
    "  - src/pages/**/*",
    "  - pages/**/*",
    "  - api-contract.yaml",
    "  - src/app/api/**/route.ts",
    "  - app/api/**/route.ts",
    "  - src/pages/api/**/*",
    "  - pages/api/**/*",
    "  - crates/routa-server/src/api/**/*.rs",
    "update_policy:",
    "  - \"Regenerate with `routa feature-tree generate` or via the Feature Explorer UI.\"",
    "  - \"Hand-edit semantic `feature_metadata` fields in this frontmatter block.\"",
    "  - \"`feature_metadata.features[].source_files` is regenerated from declared pages/APIs.\"",
    "  - \"Do not hand-edit generated endpoint or route tables below.\"",
  ];
  if (surfaceIndex.metadata) {
    lines.push(buildFrontmatterMetadata(surfaceIndex.metadata, surfaceIndex));
  }
  lines.push("---", "", `# ${tree.name} — Product Feature Specification`, "",
    `${tree.description}. This document is auto-generated from:`,
    "- Frontend routes: `src/app/**/page.tsx`, `app/**/page.tsx`, `src/pages/**/*`, `pages/**/*`",
    "- Contract API: `api-contract.yaml`",
    "- Next.js API routes: `src/app/api/**/route.ts`, `app/api/**/route.ts`, `src/pages/api/**/*`, `pages/api/**/*`",
    "- Rust API routes: `crates/routa-server/src/api/**/*.rs`",
    "- Feature metadata: `feature_metadata` frontmatter in this file (`source_files` regenerated)", "", "---", "");
  lines.push("## Frontend Pages", "", "| Page | Route | Source File | Description |", "|------|-------|-------------|-------------|");
  for (const page of surfaceIndex.pages) {
    const desc = (page.description ?? "").slice(0, 80);
    const normalizedDesc = desc && !desc.endsWith(".") ? (desc.includes(".") ? desc.split(".")[0] : desc) : desc;
    lines.push(`| ${page.title} | \`${page.route}\` | \`${page.sourceFile}\` | ${normalizedDesc} |`);
  }
  lines.push("", "---", "");
  renderContractApiSection(lines, surfaceIndex.contractApis, nextjsApis, rustApis);
  renderImplementationOnlyApiSection(lines, "## Next.js-only API Routes", filterImplementationOnlyApis(surfaceIndex.contractApis, nextjsApis));
  renderImplementationOnlyApiSection(lines, "## Rust-only API Routes", filterImplementationOnlyApis(surfaceIndex.contractApis, rustApis));
  return `${lines.join("\n")}\n`;
}

function buildFeatureTree(routes: RouteInfo[], apiFeatures: Record<string, ContractApiFeature[]>): FeatureTree {
  return {
    name: "Routa.js",
    description: "Multi-agent coordination platform",
    children: [
      {
        id: "routes", name: "Frontend Pages",
        description: `${routes.length} user-facing pages`,
        children: routes.map((r) => ({ id: r.route, name: r.title, route: r.route, description: r.description })),
      },
      {
        id: "api", name: "API Contract Endpoints",
        description: `${Object.values(apiFeatures).reduce((c, f) => c + f.length, 0)} contract endpoints`,
        children: Object.entries(apiFeatures).map(([domain, endpoints]) => ({
          id: `api.${domain}`,
          name: domain.replace(/\b\w/g, (c) => c.toUpperCase()),
          count: endpoints.length,
          children: endpoints.map((ep) => ({
            id: ep.operationId,
            name: ep.summary ? `${ep.method} ${ep.summary}` : `${ep.method} ${ep.path}`,
            path: ep.path,
          })),
        })),
      },
    ],
  };
}

// ── Public entry point ──────────────────────────────────────────────

/**
 * Generate feature tree artifacts for a repository.
 *
 * When `dryRun` is true, the function performs all scanning but does
 * not write any files. The result includes the list of files that
 * *would* have been written.
 */
export async function generateFeatureTree(options: GenerateFeatureTreeOptions): Promise<GenerateFeatureTreeResult> {
  const { repoRoot, scanRoot, metadata: metadataOverride = null, dryRun = false } = options;
  const effectiveRepoRoot = path.resolve(repoRoot);
  const preflight = preflightFeatureTree(effectiveRepoRoot);
  const effectiveScanRoot = validateScanRoot(effectiveRepoRoot, scanRoot ?? preflight.selectedScanRoot);
  const warnings = [...preflight.warnings];
  const wroteFiles: string[] = [];

  const frameworksDetected = detectFramework(effectiveScanRoot);

  const outputMd = path.join(effectiveRepoRoot, "docs", "product-specs", "FEATURE_TREE.md");
  const outputJson = path.join(effectiveRepoRoot, "docs", "product-specs", "feature-tree.index.json");

  // Scan sources
  const routes = scanFrontendRoutes(effectiveRepoRoot, effectiveScanRoot);
  const nextjsAppRouterApis = scanNextjsAppRouterApiRoutes(effectiveRepoRoot, effectiveScanRoot);
  const nextjsPagesApis = scanNextjsPagesApiRoutes(effectiveRepoRoot, effectiveScanRoot);
  const nextjsApis = [...nextjsAppRouterApis, ...nextjsPagesApis].sort((a, b) =>
    a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const rustApis = scanRustApiRoutes(effectiveRepoRoot, effectiveScanRoot);
  const apiContract = loadApiContract(effectiveRepoRoot, effectiveScanRoot);
  const metadata = metadataOverride
    ? normalizeFeatureMetadata(metadataOverride)
    : loadPersistedFeatureMetadata(effectiveRepoRoot, outputMd, outputJson);
  const apiFeatures = extractApiFeatures(apiContract);
  const tree = buildFeatureTree(routes, apiFeatures);
  const implementationApis = [
    ...nextjsAppRouterApis.map((api) => ({ ...api, label: "nextjsAppRouter" })),
    ...nextjsPagesApis.map((api) => ({ ...api, label: "nextjsPagesApi" })),
    ...rustApis.map((api) => ({ ...api, label: "rust" })),
  ];
  const surfaceIndex = buildFeatureSurfaceIndex(routes, apiFeatures, nextjsApis, rustApis, implementationApis, metadata);

  if (!apiContract && implementationApis.length === 0) {
    warnings.push("No api-contract.yaml found and no implementation APIs were detected.");
  } else if (!apiContract) {
    warnings.push("No api-contract.yaml found; using implementation-only API discovery.");
  }

  if (effectiveScanRoot !== effectiveRepoRoot) {
    warnings.push(`Scanned ${path.relative(effectiveRepoRoot, effectiveScanRoot) || "."} and wrote outputs to repo root.`);
  }

  const generatedAt = surfaceIndex.generatedAt;

  if (!dryRun) {
    fs.mkdirSync(path.dirname(outputMd), { recursive: true });
    fs.writeFileSync(outputMd, renderMarkdown(tree, surfaceIndex, nextjsApis, rustApis), "utf8");
    wroteFiles.push(path.relative(repoRoot, outputMd));
    fs.writeFileSync(outputJson, JSON.stringify(surfaceIndex, null, 2) + "\n", "utf8");
    wroteFiles.push(path.relative(repoRoot, outputJson));
    preflightCache.delete(effectiveRepoRoot);
  } else {
    wroteFiles.push(path.relative(repoRoot, outputMd), path.relative(repoRoot, outputJson));
  }

  return {
    generatedAt,
    frameworksDetected,
    wroteFiles,
    warnings: uniqueSorted(warnings),
    pagesCount: routes.length,
    apisCount: surfaceIndex.contractApis.length + implementationApis.length,
  };
}
