import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";

import { fromRoot } from "../lib/paths";
import { loadYamlFile } from "../lib/yaml";
import featureSurfaceMetadata from "../../src/core/spec/feature-surface-metadata";

const { INFERRED_GROUP_ID, buildApiLookupKey, normalizeSurfaceMetadata } = featureSurfaceMetadata;

type GenerateFeatureTreeArtifacts = (options: {
  repoRoot: string;
  scanRoot?: string;
  metadata?: FeatureMetadata | null;
  dryRun?: boolean;
}) => Promise<{
  generatedAt: string;
  frameworksDetected: string[];
  wroteFiles: string[];
  warnings: string[];
  pagesCount: number;
  apisCount: number;
}>;

type FeatureTreePreflightResult = {
  repoRoot: string;
  selectedScanRoot: string;
  frameworksDetected: string[];
  adapters: Array<{
    id: string;
    confidence: "high" | "medium";
    signals: string[];
  }>;
  candidateRoots: Array<{
    path: string;
    kind: string;
    score: number;
    surfaceCounts: {
      pages: number;
      appRouterApis: number;
      pagesApis: number;
      rustApis: number;
    };
    adapters: string[];
    warnings: string[];
  }>;
  warnings: string[];
};

type PreflightFeatureTree = (repoRoot: string) => FeatureTreePreflightResult;

async function loadFeatureTreeGeneratorModule(): Promise<{
  generateFeatureTree: GenerateFeatureTreeArtifacts;
  preflightFeatureTree: PreflightFeatureTree;
}> {
  const moduleUrl = pathToFileURL(fromRoot("src/core/spec/feature-tree-generator.ts")).href;
  const featureTreeGeneratorModule = await import(moduleUrl) as {
    generateFeatureTree?: GenerateFeatureTreeArtifacts;
    preflightFeatureTree?: PreflightFeatureTree;
    default?: {
      generateFeatureTree?: GenerateFeatureTreeArtifacts;
      preflightFeatureTree?: PreflightFeatureTree;
    };
  };

  const generateFeatureTreeArtifacts = featureTreeGeneratorModule.generateFeatureTree
    ?? featureTreeGeneratorModule.default?.generateFeatureTree;
  const preflightFeatureTree = featureTreeGeneratorModule.preflightFeatureTree
    ?? featureTreeGeneratorModule.default?.preflightFeatureTree;

  if (typeof generateFeatureTreeArtifacts !== "function") {
    throw new Error("Unable to resolve generateFeatureTree from src/core/spec/feature-tree-generator.ts");
  }
  if (typeof preflightFeatureTree !== "function") {
    throw new Error("Unable to resolve preflightFeatureTree from src/core/spec/feature-tree-generator.ts");
  }

  return {
    generateFeatureTree: generateFeatureTreeArtifacts,
    preflightFeatureTree,
  };
}

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

export type FeatureSurfaceIndex = {
  generatedAt: string;
  pages: Array<{
    route: string;
    title: string;
    description: string;
    sourceFile: string;
  }>;
  apis: Array<{
    domain: string;
    method: string;
    path: string;
    operationId: string;
    summary: string;
  }>;
  contractApis: Array<{
    domain: string;
    method: string;
    path: string;
    operationId: string;
    summary: string;
  }>;
  nextjsApis: Array<{
    domain: string;
    method: string;
    path: string;
    sourceFiles: string[];
  }>;
  rustApis: Array<{
    domain: string;
    method: string;
    path: string;
    sourceFiles: string[];
  }>;
  metadata: FeatureMetadata | null;
};

export type FeatureMetadataGroup = {
  id: string;
  name: string;
  description?: string;
};

export type FeatureMetadataItem = {
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

export type FeatureMetadata = {
  schemaVersion: number;
  capabilityGroups: FeatureMetadataGroup[];
  features: FeatureMetadataItem[];
};

type OpenApiMethod = {
  operationId?: string;
  summary?: string;
};

type OpenApiDoc = {
  paths?: Record<string, Record<string, OpenApiMethod>>;
};

const API_CONTRACT = fromRoot("api-contract.yaml");
const APP_DIR = fromRoot("src", "app");
const NEXT_API_DIR = fromRoot("src", "app", "api");
const RUST_API_DIR = fromRoot("crates", "routa-server", "src", "api");
const RUST_API_MOD = path.join(RUST_API_DIR, "mod.rs");
const RUST_LIB = fromRoot("crates", "routa-server", "src", "lib.rs");
const OUTPUT_MD = fromRoot("docs", "product-specs", "FEATURE_TREE.md");
const OUTPUT_JSON = fromRoot("docs", "product-specs", "feature-tree.index.json");
const REPO_ROOT = fromRoot();

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeString(item)).filter(Boolean);
}

export function normalizeFeatureMetadata(input: unknown): FeatureMetadata | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as {
    schemaVersion?: unknown;
    schema_version?: unknown;
    capabilityGroups?: unknown;
    capability_groups?: unknown;
    features?: unknown;
  };
  const schemaVersion = Number(raw.schemaVersion ?? raw.schema_version);

  const rawCapabilityGroups = raw.capabilityGroups ?? raw.capability_groups;
  const capabilityGroups = Array.isArray(rawCapabilityGroups)
    ? rawCapabilityGroups
      .map((group: unknown): FeatureMetadataGroup | null => {
        if (!group || typeof group !== "object") {
          return null;
        }

        const id = normalizeString((group as { id?: unknown }).id);
        const name = normalizeString((group as { name?: unknown }).name);
        if (!id || !name) {
          return null;
        }

        const description = normalizeString((group as { description?: unknown }).description);
        return {
          id,
          name,
          ...(description ? { description } : {}),
        };
      })
      .filter((group: FeatureMetadataGroup | null): group is FeatureMetadataGroup => Boolean(group))
    : [];

  const features = Array.isArray(raw.features)
    ? raw.features
      .map((feature): FeatureMetadataItem | null => {
        if (!feature || typeof feature !== "object") {
          return null;
        }

        const id = normalizeString((feature as { id?: unknown }).id);
        const name = normalizeString((feature as { name?: unknown }).name);
        if (!id || !name) {
          return null;
        }

        const group = normalizeString((feature as { group?: unknown }).group);
        const summary = normalizeString((feature as { summary?: unknown }).summary);
        const status = normalizeString((feature as { status?: unknown }).status);
        const pages = normalizeStringArray((feature as { pages?: unknown }).pages);
        const apis = normalizeStringArray((feature as { apis?: unknown }).apis);
        const domainObjects = normalizeStringArray(
          (feature as { domainObjects?: unknown; domain_objects?: unknown }).domainObjects
            ?? (feature as { domain_objects?: unknown }).domain_objects,
        );
        const relatedFeatures = normalizeStringArray(
          (feature as { relatedFeatures?: unknown; related_features?: unknown }).relatedFeatures
            ?? (feature as { related_features?: unknown }).related_features,
        );
        const sourceFiles = normalizeStringArray(
          (feature as { sourceFiles?: unknown; source_files?: unknown }).sourceFiles
            ?? (feature as { source_files?: unknown }).source_files,
        );
        const screenshots = normalizeStringArray((feature as { screenshots?: unknown }).screenshots);

        return {
          id,
          name,
          ...(group ? { group } : {}),
          ...(summary ? { summary } : {}),
          ...(status ? { status } : {}),
          ...(pages.length > 0 ? { pages } : {}),
          ...(apis.length > 0 ? { apis } : {}),
          ...(domainObjects.length > 0 ? { domainObjects } : {}),
          ...(relatedFeatures.length > 0 ? { relatedFeatures } : {}),
          ...(sourceFiles.length > 0 ? { sourceFiles } : {}),
          ...(screenshots.length > 0 ? { screenshots } : {}),
        };
      })
      .filter((feature): feature is FeatureMetadataItem => Boolean(feature))
    : [];

  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1,
    capabilityGroups,
    features,
  };
}

export function readFeatureMetadataFromFeatureTree(markdown: string): FeatureMetadata | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(match[1]);
  } catch {
    return null;
  }

  const featureMetadata = parsed && typeof parsed === "object"
    ? (parsed as { feature_metadata?: unknown }).feature_metadata
    : null;

  return normalizeFeatureMetadata(featureMetadata);
}

export function readFeatureMetadataFromSurfaceIndex(raw: string): FeatureMetadata | null {
  if (!raw.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const metadata = parsed && typeof parsed === "object"
    ? (parsed as { metadata?: unknown }).metadata
    : null;

  return normalizeFeatureMetadata(metadata);
}

function readTrackedFileFromHead(relativePath: string): string {
  try {
    return execFileSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function loadPersistedFeatureMetadata(existingFeatureTree: string, existingSurfaceIndex: string): FeatureMetadata | null {
  return readFeatureMetadataFromFeatureTree(existingFeatureTree)
    ?? readFeatureMetadataFromSurfaceIndex(existingSurfaceIndex)
    ?? readFeatureMetadataFromFeatureTree(readTrackedFileFromHead("docs/product-specs/FEATURE_TREE.md"));
}

export function parsePageComment(content: string): { title: string | null; description: string | null } {
  const match = content.match(/\/\*\*\s*(.*?)\s*\*\//s);
  if (!match) {
    return { title: null, description: null };
  }

  const lines = match[1]
    .split("\n")
    .map((line) => line.trim().replace(/^\*\s?/, ""))
    .filter(Boolean);
  if (lines.length === 0) {
    return { title: null, description: null };
  }

  const titleLine = lines[0];
  const titleMatch = titleLine.match(/^(.+?)\s*[-—]\s*\/.*$/);
  const title = titleMatch ? titleMatch[1].trim() : titleLine;
  const description = lines
    .slice(1)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return { title, description: description || null };
}

function formatRouteSegment(segment: string): string {
  let normalized = segment.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith(":")) {
    normalized = normalized.slice(1);
  }
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const inner = normalized.slice(1, -1).replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    return inner.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return normalized.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toRepoRelative(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
}

function domainFromApiPath(apiPath: string): string {
  const match = apiPath.match(/^\/api\/([^/]+)/);
  return match?.[1] ?? "root";
}

function normalizeApiPathSegment(segment: string): string {
  if (!segment.startsWith("[") || !segment.endsWith("]")) {
    return segment;
  }

  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `{${segment.slice(4, -1)}}`;
  }

  return `{${segment.slice(1, -1)}}`;
}

function normalizeNextjsApiPath(relativeDir: string): string {
  const normalized = relativeDir === "." ? "" : relativeDir.replace(/\\/g, "/");
  const segments = normalized
    .split("/")
    .filter(Boolean)
    .map(normalizeApiPathSegment);
  return segments.length > 0 ? `/api/${segments.join("/")}` : "/api";
}

function scanNextjsApiRoutes(): ImplementationApiRoute[] {
  const routes = new Map<string, ImplementationApiRoute>();
  const exportedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.name !== "route.ts" && entry.name !== "route.js") {
        continue;
      }

      const relativeDir = path.relative(NEXT_API_DIR, path.dirname(fullPath));
      const routePath = normalizeNextjsApiPath(relativeDir);
      const content = fs.readFileSync(fullPath, "utf8");
      const sourceFile = toRepoRelative(fullPath);

      for (const method of exportedMethods) {
        const regex = new RegExp(
          `export\\s+(async\\s+)?function\\s+${method}\\b|export\\s*\\{[^}]*\\b${method}\\b`,
        );
        if (!regex.test(content)) {
          continue;
        }

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

  walk(NEXT_API_DIR);
  return [...routes.values()].sort((left, right) =>
    left.domain.localeCompare(right.domain)
    || left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method),
  );
}

type RustModuleContent = {
  content: string;
  sourceFiles: string[];
};

function listRustSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRustSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function extractMethods(handlerChain: string): string[] {
  const methods: string[] = [];
  for (const method of ["get", "post", "put", "delete", "patch"]) {
    const regex = new RegExp(`(?:^|[\\s.:])${method}\\(`, "g");
    if (regex.test(handlerChain)) {
      methods.push(method.toUpperCase());
    }
  }
  return methods;
}

function extractRouteCalls(content: string): Array<{ subPath: string; handlerChain: string }> {
  const results: Array<{ subPath: string; handlerChain: string }> = [];
  const prefix = ".route(";
  let index = 0;

  while (index < content.length) {
    const routeIndex = content.indexOf(prefix, index);
    if (routeIndex === -1) {
      break;
    }

    let cursor = routeIndex + prefix.length;
    while (cursor < content.length && /\s/.test(content[cursor] ?? "")) {
      cursor += 1;
    }

    if (content[cursor] !== "\"") {
      index = cursor + 1;
      continue;
    }
    cursor += 1;

    let subPath = "";
    while (cursor < content.length && content[cursor] !== "\"") {
      subPath += content[cursor];
      cursor += 1;
    }
    cursor += 1;

    while (cursor < content.length && /[\s,]/.test(content[cursor] ?? "")) {
      cursor += 1;
    }

    let depth = 1;
    const handlerStart = cursor;
    while (cursor < content.length && depth > 0) {
      if (content[cursor] === "(") {
        depth += 1;
      } else if (content[cursor] === ")") {
        depth -= 1;
      }
      if (depth > 0) {
        cursor += 1;
      }
    }

    results.push({
      subPath,
      handlerChain: content.slice(handlerStart, cursor),
    });
    index = cursor + 1;
  }

  return results;
}

function extractNestCalls(
  content: string,
): Array<{ basePath: string; modulePath: string; functionName: string }> {
  const results: Array<{ basePath: string; modulePath: string; functionName: string }> = [];
  const regex = /\.nest\("([^"]+)",\s*([\w:]+)::(\w+)\([^)]*\)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    results.push({
      basePath: match[1] ?? "",
      modulePath: match[2] ?? "",
      functionName: match[3] ?? "",
    });
  }

  return results;
}

function joinRustRoutePaths(basePath: string, subPath: string): string {
  const normalizedBase = basePath.replace(/\/+$/, "");
  const normalizedSubPath = subPath === "/" ? "" : subPath;
  return `${normalizedBase}${normalizedSubPath || ""}` || "/";
}

function readRustApiModule(moduleName: string): RustModuleContent | null {
  const moduleFile = path.join(RUST_API_DIR, `${moduleName}.rs`);
  const moduleDir = path.join(RUST_API_DIR, moduleName);
  const files: string[] = [];

  if (fs.existsSync(moduleFile)) {
    files.push(moduleFile);
  }
  files.push(...listRustSourceFiles(moduleDir));

  if (files.length === 0) {
    return null;
  }

  return {
    content: files.map((file) => fs.readFileSync(file, "utf8")).join("\n"),
    sourceFiles: files.map(toRepoRelative),
  };
}

function recordImplementationApiRoute(
  routes: Map<string, ImplementationApiRoute>,
  route: Omit<ImplementationApiRoute, "domain"> & { domain?: string },
): void {
  const key = `${route.method} ${route.path}`;
  const existing = routes.get(key);
  const sourceFiles = [...new Set(route.sourceFiles)].sort();

  if (!existing) {
    routes.set(key, {
      method: route.method,
      path: route.path,
      domain: route.domain ?? domainFromApiPath(route.path),
      sourceFiles,
    });
    return;
  }

  routes.set(key, {
    ...existing,
    sourceFiles: [...new Set([...existing.sourceFiles, ...sourceFiles])].sort(),
  });
}

function collectRustApiRoutes(params: {
  content: string;
  basePath: string;
  sourceFiles: string[];
  visitedRouters: Set<string>;
  routes: Map<string, ImplementationApiRoute>;
}): void {
  const { content, basePath, sourceFiles, visitedRouters, routes } = params;

  for (const { subPath, handlerChain } of extractRouteCalls(content)) {
    const fullPath = joinRustRoutePaths(basePath, subPath);
    for (const method of extractMethods(handlerChain)) {
      recordImplementationApiRoute(routes, {
        method,
        path: fullPath,
        sourceFiles,
      });
    }
  }

  for (const nest of extractNestCalls(content)) {
    const moduleName = nest.modulePath.split("::").filter(Boolean).at(-1);
    if (!moduleName) {
      continue;
    }

    const visitKey = `${basePath}::${nest.basePath}::${nest.modulePath}::${nest.functionName}`;
    if (visitedRouters.has(visitKey)) {
      continue;
    }
    visitedRouters.add(visitKey);

    const apiModule = readRustApiModule(moduleName);
    if (!apiModule) {
      continue;
    }

    collectRustApiRoutes({
      content: apiModule.content,
      basePath: joinRustRoutePaths(basePath, nest.basePath),
      sourceFiles: apiModule.sourceFiles,
      visitedRouters,
      routes,
    });
  }
}

function scanRustApiRoutes(): ImplementationApiRoute[] {
  const routes = new Map<string, ImplementationApiRoute>();
  const visitedRouters = new Set<string>();

  if (fs.existsSync(RUST_API_MOD)) {
    collectRustApiRoutes({
      content: fs.readFileSync(RUST_API_MOD, "utf8"),
      basePath: "",
      sourceFiles: [toRepoRelative(RUST_API_MOD)],
      visitedRouters,
      routes,
    });
  }

  for (const directFile of [RUST_API_MOD, RUST_LIB]) {
    if (!fs.existsSync(directFile)) {
      continue;
    }

    const content = fs.readFileSync(directFile, "utf8");
    for (const { subPath, handlerChain } of extractRouteCalls(content)) {
      if (!subPath.startsWith("/api/")) {
        continue;
      }

      for (const method of extractMethods(handlerChain)) {
        recordImplementationApiRoute(routes, {
          method,
          path: subPath,
          sourceFiles: [toRepoRelative(directFile)],
        });
      }
    }
  }

  return [...routes.values()].sort((left, right) =>
    left.domain.localeCompare(right.domain)
    || left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method),
  );
}

function scanFrontendRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.name !== "page.tsx") {
        continue;
      }
      if (fullPath.includes(`${path.sep}api${path.sep}`)) {
        continue;
      }

      const relDir = path.relative(APP_DIR, path.dirname(fullPath));
      let route = `/${relDir.replace(/\\/g, "/")}`;
      if (route === "/") {
        route = "/";
      } else if (route === "/.") {
        route = "/";
      }
      route = route.replace(/\[([^\]]+)\]/g, ":$1");

      const content = fs.readFileSync(fullPath, "utf8");
      const parsed = parsePageComment(content);
      let title = parsed.title?.trim();

      if (!title) {
        if (route === "/") {
          title = "Home";
        } else {
          const pathSegments = relDir.split(path.sep).filter(Boolean);
          const staticSegments = pathSegments
            .filter((segment) => !(segment.startsWith("[") && segment.endsWith("]")))
            .map(formatRouteSegment)
            .filter(Boolean);
          title = staticSegments.slice(-2).join(" / ").trim() || formatRouteSegment(pathSegments.at(-1) ?? "") || "Page";
        }
      }

      routes.push({
        route,
        title,
        description: parsed.description ?? "",
        sourceFile: path.relative(process.cwd(), fullPath).replace(/\\/g, "/"),
      });
    }
  }

  walk(APP_DIR);
  return routes.sort((left, right) => left.route.localeCompare(right.route));
}

export function extractApiFeatures(apiContract: OpenApiDoc | null): Record<string, ContractApiFeature[]> {
  if (!apiContract?.paths) {
    return {};
  }

  const domains = new Map<string, ContractApiFeature[]>();
  for (const [apiPath, methods] of Object.entries(apiContract.paths)) {
    const match = apiPath.match(/^\/api\/([^/]+)/);
    if (!match) {
      continue;
    }
    const domain = match[1];
    const domainFeatures = domains.get(domain) ?? [];
    for (const [method, spec] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        continue;
      }
      domainFeatures.push({
        domain,
        path: apiPath,
        method: method.toUpperCase(),
        operationId: spec.operationId ?? "",
        summary: spec.summary ?? "",
      });
    }
    domains.set(domain, domainFeatures);
  }

  return Object.fromEntries([...domains.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function buildFeatureTree(routes: RouteInfo[], apiFeatures: Record<string, ContractApiFeature[]>): FeatureTree {
  const routesNode: FeatureNode = {
    id: "routes",
    name: "Frontend Pages",
    description: `${routes.length} user-facing pages`,
    children: routes.map((route) => ({
      id: route.route,
      name: route.title,
      route: route.route,
      description: route.description,
    })),
  };

  const domainNames: Record<string, string> = {
    health: "Health",
    agents: "Agents",
    tasks: "Tasks",
    notes: "Notes",
    workspaces: "Workspaces",
    sessions: "Sessions",
    acp: "ACP",
    mcp: "MCP",
    a2a: "A2A",
    skills: "Skills",
    clone: "Clone",
    github: "GitHub",
  };

  const apiNode: FeatureNode = {
    id: "api",
    name: "API Contract Endpoints",
    description: `${Object.values(apiFeatures).reduce((count, features) => count + features.length, 0)} contract endpoints`,
    children: Object.entries(apiFeatures).map(([domain, endpoints]) => ({
      id: `api.${domain}`,
      name: domainNames[domain] ?? domain.replace(/\b\w/g, (char) => char.toUpperCase()),
      count: endpoints.length,
      children: endpoints.map((endpoint) => ({
        id: endpoint.operationId,
        name: endpoint.summary ? `${endpoint.method} ${endpoint.summary}` : `${endpoint.method} ${endpoint.path}`,
        path: endpoint.path,
      })),
    })),
  };

  return {
    name: "Routa.js",
    description: "Multi-agent coordination platform",
    children: [routesNode, apiNode],
  };
}

function flattenContractApis(apiFeatures: Record<string, ContractApiFeature[]>): ContractApiFeature[] {
  return Object.values(apiFeatures)
    .flatMap((features) => features)
    .sort((left, right) => {
      if (left.domain !== right.domain) {
        return left.domain.localeCompare(right.domain);
      }
      if (left.path !== right.path) {
        return left.path.localeCompare(right.path);
      }
      return left.method.localeCompare(right.method);
    });
}

function augmentFeatureMetadata(params: {
  metadata: FeatureMetadata | null;
  routes: RouteInfo[];
  contractApis: ContractApiFeature[];
  nextjsApis: ImplementationApiRoute[];
  rustApis: ImplementationApiRoute[];
}): FeatureMetadata | null {
  const { metadata } = params;
  return normalizeSurfaceMetadata({
    metadata,
    pages: params.routes,
    contractApis: params.contractApis,
    nextjsApis: params.nextjsApis,
    rustApis: params.rustApis,
  });
}

export function buildFeatureSurfaceIndex(
  routes: RouteInfo[],
  apiFeatures: Record<string, ContractApiFeature[]>,
  nextjsApis: ImplementationApiRoute[],
  rustApis: ImplementationApiRoute[],
  metadata: FeatureMetadata | null = null,
): FeatureSurfaceIndex {
  const contractApis = flattenContractApis(apiFeatures).map((feature) => ({
    domain: feature.domain,
    method: feature.method,
    path: feature.path,
    operationId: feature.operationId,
    summary: feature.summary,
  }));
  const augmentedMetadata = augmentFeatureMetadata({
    metadata,
    routes,
    contractApis,
    nextjsApis,
    rustApis,
  });

  return {
    generatedAt: new Date().toISOString(),
    pages: routes.map((route) => ({
      route: route.route,
      title: route.title,
      description: route.description,
      sourceFile: route.sourceFile,
    })),
    apis: contractApis,
    contractApis,
    nextjsApis: nextjsApis.map((api) => ({
      domain: api.domain,
      method: api.method,
      path: api.path,
      sourceFiles: api.sourceFiles,
    })),
    rustApis: rustApis.map((api) => ({
      domain: api.domain,
      method: api.method,
      path: api.path,
      sourceFiles: api.sourceFiles,
    })),
    metadata: augmentedMetadata,
  };
}

function apiDeclarationSpecificity(declaration: string): number {
  const placeholderMatches = declaration.match(/\{[A-Za-z0-9_]+\}|:[A-Za-z0-9_]+/g) ?? [];
  return placeholderMatches.reduce((score, match) => score + match.length, 0);
}

function buildPreferredApiDeclarations(surfaceIndex: FeatureSurfaceIndex): Map<string, string> {
  const preferred = new Map<string, string>();
  const setPreferred = (method: string, endpointPath: string) => {
    const declaration = `${method.trim().toUpperCase()} ${endpointPath.trim()}`.trim();
    preferred.set(buildApiLookupKey(method, endpointPath), declaration);
  };
  const setIfMissing = (method: string, endpointPath: string) => {
    const declaration = `${method.trim().toUpperCase()} ${endpointPath.trim()}`.trim();
    const key = buildApiLookupKey(method, endpointPath);
    if (!preferred.has(key)) {
      preferred.set(key, declaration);
    }
  };

  for (const api of surfaceIndex.contractApis) {
    setPreferred(api.method, api.path);
  }
  for (const api of surfaceIndex.nextjsApis) {
    setIfMissing(api.method, api.path);
  }
  for (const api of surfaceIndex.rustApis) {
    setIfMissing(api.method, api.path);
  }

  return preferred;
}

function buildFrontmatterMetadata(metadata: FeatureMetadata, surfaceIndex: FeatureSurfaceIndex): string {
  const preferredApiDeclarations = buildPreferredApiDeclarations(surfaceIndex);
  const persistedMetadata: FeatureMetadata = {
    schemaVersion: metadata.schemaVersion,
    capabilityGroups: metadata.capabilityGroups.filter((group) => group.id !== INFERRED_GROUP_ID),
    features: metadata.features
      .filter((feature) => feature.group !== INFERRED_GROUP_ID && feature.status !== "inferred")
      .map((feature) => {
        if (!feature.apis?.length) {
          return feature;
        }

        const sanitizedApiDeclarations = new Map<string, string>();
        for (const declaration of feature.apis) {
          const [method = "GET", endpointPath = declaration.trim()] = declaration.trim().split(/\s+/, 2);
          const key = buildApiLookupKey(method, endpointPath);
          const preferredDeclaration = preferredApiDeclarations.get(key) ?? declaration.trim();
          const existing = sanitizedApiDeclarations.get(key);
          if (!existing || apiDeclarationSpecificity(preferredDeclaration) > apiDeclarationSpecificity(existing)) {
            sanitizedApiDeclarations.set(key, preferredDeclaration);
          }
        }

        return {
          ...feature,
          apis: [...sanitizedApiDeclarations.values()].sort(),
        };
      }),
  };

  return yaml.dump(
    {
      feature_metadata: {
        schema_version: persistedMetadata.schemaVersion,
        capability_groups: persistedMetadata.capabilityGroups.map((group) => ({
          id: group.id,
          name: group.name,
          ...(group.description ? { description: group.description } : {}),
        })),
        features: persistedMetadata.features.map((feature) => ({
          id: feature.id,
          name: feature.name,
          ...(feature.group ? { group: feature.group } : {}),
          ...(feature.summary ? { summary: feature.summary } : {}),
          ...(feature.status ? { status: feature.status } : {}),
          ...(feature.pages?.length ? { pages: feature.pages } : {}),
          ...(feature.apis?.length ? { apis: feature.apis } : {}),
          ...(feature.domainObjects?.length ? { domain_objects: feature.domainObjects } : {}),
          ...(feature.relatedFeatures?.length ? { related_features: feature.relatedFeatures } : {}),
          ...(feature.sourceFiles?.length ? { source_files: feature.sourceFiles } : {}),
          ...(feature.screenshots?.length ? { screenshots: feature.screenshots } : {}),
        })),
      },
    },
  ).trimEnd();
}

function renderContractApiSection(
  lines: string[],
  apis: FeatureSurfaceIndex["contractApis"],
  nextjsApis: ImplementationApiRoute[],
  rustApis: ImplementationApiRoute[],
): void {
  const grouped = new Map<string, FeatureSurfaceIndex["contractApis"][number][]>();
  const nextjsLookup = new Map(nextjsApis.map((api) => [buildApiLookupKey(api.method, api.path), api.sourceFiles]));
  const rustLookup = new Map(rustApis.map((api) => [buildApiLookupKey(api.method, api.path), api.sourceFiles]));

  for (const api of apis) {
    const current = grouped.get(api.domain) ?? [];
    current.push(api);
    grouped.set(api.domain, current);
  }

  lines.push("## API Contract Endpoints", "");
  for (const [domain, endpoints] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const domainName = domain.replace(/\b\w/g, (char) => char.toUpperCase());
    lines.push(`### ${domainName} (${endpoints.length})`, "");
    lines.push("| Method | Endpoint | Details | Next.js | Rust |", "|--------|----------|---------|---------|------|");
    for (const endpoint of endpoints) {
      const key = buildApiLookupKey(endpoint.method, endpoint.path);
      lines.push(
        `| ${endpoint.method} | \`${endpoint.path}\` | ${endpoint.summary || endpoint.operationId || ""} | ${formatSourceFiles(nextjsLookup.get(key) ?? [])} | ${formatSourceFiles(rustLookup.get(key) ?? [])} |`,
      );
    }
    lines.push("");
  }
}

function filterImplementationOnlyApis(
  contractApis: FeatureSurfaceIndex["contractApis"],
  implementationApis: ImplementationApiRoute[],
): ImplementationApiRoute[] {
  const contractKeys = new Set(contractApis.map((api) => buildApiLookupKey(api.method, api.path)));
  return implementationApis.filter((api) => !contractKeys.has(buildApiLookupKey(api.method, api.path)));
}

function renderImplementationOnlyApiSection(
  lines: string[],
  title: string,
  apis: ImplementationApiRoute[],
): void {
  if (apis.length === 0) {
    return;
  }

  const grouped = new Map<string, ImplementationApiRoute[]>();
  for (const api of apis) {
    const current = grouped.get(api.domain) ?? [];
    current.push(api);
    grouped.set(api.domain, current);
  }

  lines.push("---", "", title, "");
  for (const [domain, endpoints] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const domainName = domain.replace(/\b\w/g, (char) => char.toUpperCase());
    lines.push(`### ${domainName} (${endpoints.length})`, "");
    lines.push("| Method | Endpoint | Source Files |", "|--------|----------|--------------|");
    for (const endpoint of endpoints) {
      lines.push(`| ${endpoint.method} | \`${endpoint.path}\` | ${formatSourceFiles(endpoint.sourceFiles)} |`);
    }
    lines.push("");
  }
}

function formatSourceFiles(sourceFiles: string[]): string {
  if (sourceFiles.length === 0) {
    return "";
  }
  return sourceFiles.map((file) => `\`${file}\``).join(", ");
}

export function renderMarkdown(
  tree: FeatureTree,
  surfaceIndex: FeatureSurfaceIndex,
): string {
  const lines: string[] = [
    "---",
    "status: generated",
    "purpose: Auto-generated route and API surface index for Routa.js.",
    "sources:",
    "  - src/app/**/page.tsx",
    "  - api-contract.yaml",
    "  - src/app/api/**/route.ts",
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

  lines.push(
    "---",
    "",
    `# ${tree.name} — Product Feature Specification`,
    "",
    `${tree.description}. This document is auto-generated from:`,
    "- Frontend routes: `src/app/**/page.tsx`",
    "- Contract API: `api-contract.yaml`",
    "- Next.js API routes: `src/app/api/**/route.ts`",
    "- Rust API routes: `crates/routa-server/src/api/**/*.rs`",
    "- Feature metadata: `feature_metadata` frontmatter in this file (`source_files` regenerated)",
    "",
    "---",
    "",
  );

  lines.push("## Frontend Pages", "", "| Page | Route | Source File | Description |", "|------|-------|-------------|-------------|");
  for (const page of surfaceIndex.pages) {
    const description = (page.description ?? "").slice(0, 80);
    const normalizedDescription = description && !description.endsWith(".")
      ? (description.includes(".") ? description.split(".")[0] : description)
      : description;
    lines.push(`| ${page.title} | \`${page.route}\` | \`${page.sourceFile}\` | ${normalizedDescription} |`);
  }

  lines.push("", "---", "");
  renderContractApiSection(lines, surfaceIndex.contractApis, surfaceIndex.nextjsApis, surfaceIndex.rustApis);
  renderImplementationOnlyApiSection(
    lines,
    "## Next.js-only API Routes",
    filterImplementationOnlyApis(surfaceIndex.contractApis, surfaceIndex.nextjsApis),
  );
  renderImplementationOnlyApiSection(
    lines,
    "## Rust-only API Routes",
    filterImplementationOnlyApis(surfaceIndex.contractApis, surfaceIndex.rustApis),
  );

  return `${lines.join("\n")}\n`;
}

function renderMermaid(tree: FeatureTree): string {
  const lines = ["mindmap", `  root((${tree.name}))`];

  const addNode = (node: FeatureNode, depth = 2): void => {
    const indent = "  ".repeat(depth);
    const name = node.name.replace(/\(/g, "[").replace(/\)/g, "]").replace(/"/g, "'");
    lines.push(`${indent}${name}`);
    for (const child of node.children ?? []) {
      addNode(child, depth + 1);
    }
  };

  for (const child of tree.children) {
    addNode(child);
  }

  return lines.join("\n");
}

function printTreeTable(tree: FeatureTree): void {
  console.log("=".repeat(100));
  console.log("🌳 FEATURE TREE REPORT");
  console.log("=".repeat(100));
  console.log("");

  const printNode = (node: FeatureNode, prefix = "", isLast = true): void => {
    const connector = isLast ? "└── " : "├── ";
    console.log(`${prefix}${connector}${node.path ? `${node.name} [${node.path}]` : node.name}`);
    const children = node.children ?? [];
    for (const [index, child] of children.entries()) {
      printNode(child, `${prefix}${isLast ? "    " : "│   "}`, index === children.length - 1);
    }
  };

  console.log(`📦 ${tree.name}`);
  console.log(`   ${tree.description}`);
  console.log("");
  for (const [index, child] of tree.children.entries()) {
    printNode(child, "", index === tree.children.length - 1);
  }

  const countNodes = (node: FeatureNode | FeatureTree): number =>
    1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

  console.log("");
  console.log("-".repeat(100));
  console.log(`📊 Total features: ${countNodes(tree) - 1}`);
}

function hasArg(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function getArgValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const { generateFeatureTree, preflightFeatureTree } = await loadFeatureTreeGeneratorModule();
  const mode = getArgValue(argv, "--mode");
  const repoRoot = path.resolve(getArgValue(argv, "--repo-root") ?? REPO_ROOT);
  const scanRoot = getArgValue(argv, "--scan-root");
  const metadataFile = getArgValue(argv, "--metadata-file");

  if (mode === "preflight") {
    console.log(JSON.stringify(preflightFeatureTree(repoRoot), null, 2));
    return;
  }

  if (mode === "generate") {
    const result = await generateFeatureTree({
      repoRoot,
      ...(scanRoot ? { scanRoot: path.resolve(scanRoot) } : {}),
      dryRun: hasArg(argv, "--dry-run") || !hasArg(argv, "--write"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (mode === "commit") {
    let metadata: FeatureMetadata | null = null;
    if (metadataFile) {
      const raw = fs.readFileSync(path.resolve(metadataFile), "utf8");
      metadata = normalizeFeatureMetadata(JSON.parse(raw));
    }

    const result = await generateFeatureTree({
      repoRoot,
      ...(scanRoot ? { scanRoot: path.resolve(scanRoot) } : {}),
      ...(metadata ? { metadata } : {}),
      dryRun: false,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.has("--json")) {
    const result = await generateFeatureTree({
      repoRoot: REPO_ROOT,
      dryRun: true,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const routes = scanFrontendRoutes();
  const nextjsApis = scanNextjsApiRoutes();
  const rustApis = scanRustApiRoutes();
  const apiContract = loadYamlFile<OpenApiDoc>(API_CONTRACT);
  const existingFeatureTree = fs.existsSync(OUTPUT_MD) ? fs.readFileSync(OUTPUT_MD, "utf8") : "";
  const existingSurfaceIndex = fs.existsSync(OUTPUT_JSON) ? fs.readFileSync(OUTPUT_JSON, "utf8") : "";
  const metadata = loadPersistedFeatureMetadata(existingFeatureTree, existingSurfaceIndex);
  const apiFeatures = extractApiFeatures(apiContract);
  const tree = buildFeatureTree(routes, apiFeatures);
  const surfaceIndex = buildFeatureSurfaceIndex(routes, apiFeatures, nextjsApis, rustApis, metadata);

  if (args.has("--mermaid")) {
    console.log(renderMermaid(tree));
    return;
  }
  if (args.has("--save")) {
    const result = await generateFeatureTree({
      repoRoot: REPO_ROOT,
      dryRun: false,
    });
    for (const file of result.wroteFiles) {
      console.log(`✅ Saved to ${fromRoot(file)}`);
    }
    return;
  }
  printTreeTable(tree);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
