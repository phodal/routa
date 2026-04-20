#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import featureSurfaceMetadata from "../../src/core/spec/feature-surface-metadata";

const {
  buildApiLookupKey,
  mergeSurfaceMetadata,
  normalizeSurfaceMetadata,
  stripInferredSurfaceMetadata,
  validateSurfaceMetadata,
} = featureSurfaceMetadata;

type RouteInfo = {
  route: string;
  title: string;
  description: string;
  sourceFile: string;
};

type ContractApiFeature = {
  domain: string;
  method: string;
  path: string;
  operationId: string;
  summary: string;
};

type ImplementationApiRoute = {
  label: string;
  domain: string;
  method: string;
  path: string;
  sourceFiles: string[];
};

type FeatureSurfaceIndex = {
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
  implementationApis: Array<{
    label: string;
    domain: string;
    method: string;
    path: string;
    sourceFiles: string[];
  }>;
  metadata: FeatureMetadata | null;
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

type FeatureMetadata = {
  schemaVersion: number;
  capabilityGroups: FeatureMetadataGroup[];
  features: FeatureMetadataItem[];
};

type GeneratedFeatureTree = {
  framework: "spring-boot";
  productName: string;
  productDescription: string;
  sources: string[];
  pages: RouteInfo[];
  contractApis: ContractApiFeature[];
  implementationApis: ImplementationApiRoute[];
  metadata: FeatureMetadata | null;
};

type CliArgs = {
  repoRoot: string;
  save: boolean;
  json: boolean;
  metadataJsonPath: string | null;
  specialistPath: string | null;
  specialistProvider: string | null;
  specialistPrompt: string | null;
  routaBin: string;
  routaDbPath: string;
};

type SpringControllerRoute = {
  controllerName: string;
  methodName: string;
  httpMethod: string;
  route: string;
  sourceFile: string;
  summary: string;
  templateName: string | null;
  templateSourceFile: string | null;
};

const GENERATOR_PATH = "scripts/docs/framework-feature-tree-generator.ts";
const OUTPUT_MD_RELATIVE = path.join("docs", "product-specs", "FEATURE_TREE.md");
const OUTPUT_JSON_RELATIVE = path.join("docs", "product-specs", "feature-tree.index.json");
const SPRING_IMPLEMENTATION_LABEL = "springMvc";
const DEFAULT_SPECIALIST_PROMPT =
  "Analyze this Spring Boot repository and return only the required feature metadata JSON based on the generated surface inventory and repository evidence.";

function resolveDefaultRoutaBin(): string {
  const candidate = path.resolve(
    process.cwd(),
    "target",
    "debug",
    process.platform === "win32" ? "routa.exe" : "routa",
  );
  return fs.existsSync(candidate) ? candidate : "routa";
}

function resolveDefaultRoutaDbPath(): string {
  return path.join(os.tmpdir(), "routa-feature-tree-specialist.db");
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizeFeatureMetadata(input: unknown): FeatureMetadata | null {
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
  const rawCapabilityGroups = raw.capabilityGroups ?? raw.capability_groups;

  const capabilityGroups = Array.isArray(rawCapabilityGroups)
    ? rawCapabilityGroups
      .map((group): FeatureMetadataGroup | null => {
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
      .filter((group): group is FeatureMetadataGroup => Boolean(group))
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

  const schemaVersion = Number(raw.schemaVersion ?? raw.schema_version);

  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1,
    capabilityGroups,
    features,
  };
}

function parseArgs(argv: string[]): CliArgs {
  let repoRoot = process.cwd();
  let save = false;
  let json = false;
  let metadataJsonPath: string | null = null;
  let specialistPath: string | null = null;
  let specialistProvider: string | null = null;
  let specialistPrompt: string | null = null;
  let routaBin = resolveDefaultRoutaBin();
  let routaDbPath = resolveDefaultRoutaDbPath();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--repo-root") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--repo-root requires a path");
      }
      repoRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (value === "--save") {
      save = true;
      continue;
    }
    if (value === "--json") {
      json = true;
      continue;
    }
    if (value === "--metadata-json") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--metadata-json requires a path");
      }
      metadataJsonPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (value === "--specialist") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--specialist requires a path");
      }
      specialistPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (value === "--specialist-provider") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--specialist-provider requires a provider id");
      }
      specialistProvider = next.trim();
      index += 1;
      continue;
    }
    if (value === "--specialist-prompt") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--specialist-prompt requires a prompt");
      }
      specialistPrompt = next;
      index += 1;
      continue;
    }
    if (value === "--routa-bin") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--routa-bin requires a path or command name");
      }
      routaBin = next;
      index += 1;
      continue;
    }
    if (value === "--routa-db") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--routa-db requires a path");
      }
      routaDbPath = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (specialistPath && !save) {
    throw new Error("--specialist requires --save so the generated surface inventory exists on disk before specialist analysis");
  }

  return {
    repoRoot,
    save,
    json,
    metadataJsonPath,
    specialistPath,
    specialistProvider,
    specialistPrompt,
    routaBin,
    routaDbPath,
  };
}

function ensureSpringBootRepo(repoRoot: string): void {
  const pomPath = path.join(repoRoot, "pom.xml");
  if (!fs.existsSync(pomPath)) {
    throw new Error(`Spring Boot project not found: missing ${pomPath}`);
  }

  const pom = fs.readFileSync(pomPath, "utf8");
  if (!pom.includes("spring-boot")) {
    throw new Error(`Unsupported project at ${repoRoot}: pom.xml does not look like Spring Boot`);
  }
}

function toRepoRelative(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function stripSurroundingQuotes(value: string): string {
  return value.trim().replace(/^"/u, "").replace(/"$/u, "");
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/^\/+/u, "")
    .replace(/\.[^.]+$/u, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Surface";
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function parsePomMetadata(repoRoot: string): { productName: string; productDescription: string } {
  const pom = fs.readFileSync(path.join(repoRoot, "pom.xml"), "utf8");
  const nameMatch = pom.match(/<name>([^<]+)<\/name>/u);
  const artifactMatch = pom.match(/<artifactId>([^<]+)<\/artifactId>/u);
  const descriptionMatch = pom.match(/<description>([^<]+)<\/description>/u);

  const productName = stripSurroundingQuotes(nameMatch?.[1] ?? artifactMatch?.[1] ?? "Spring Boot App");
  const productDescription = stripSurroundingQuotes(
    descriptionMatch?.[1] ?? "Spring Boot application surface inventory",
  );

  return { productName, productDescription };
}

function loadPersistedFeatureMetadata(repoRoot: string): FeatureMetadata | null {
  const surfaceIndexPath = path.join(repoRoot, OUTPUT_JSON_RELATIVE);
  if (fs.existsSync(surfaceIndexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(surfaceIndexPath, "utf8")) as {
        metadata?: unknown;
      };
      const metadata = normalizeFeatureMetadata(parsed.metadata);
      if (metadata) {
        return metadata;
      }
    } catch {
      // Ignore malformed persisted metadata and regenerate from the codebase.
    }
  }

  return null;
}

function loadMetadataFromJsonFile(metadataJsonPath: string | null): FeatureMetadata | null {
  if (!metadataJsonPath) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(metadataJsonPath, "utf8")) as {
    metadata?: unknown;
  };
  return normalizeFeatureMetadata(parsed?.metadata ?? parsed);
}

function readQuotedYamlScalar(raw: string, key: string): string {
  const match = raw.match(new RegExp(`^${key}:\\s*"([^"]*)"\\s*$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function readLiteralYamlBlock(raw: string, key: string): string {
  const lines = raw.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith(`${key}: |`));
  if (startIndex < 0) {
    return "";
  }

  const block: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("  ")) {
      block.push(line.slice(2));
      continue;
    }
    if (!line.trim()) {
      block.push("");
      continue;
    }
    break;
  }

  return block.join("\n").trim();
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Expected JSON output but received empty content");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through and try extracting a JSON object from prose / code fences.
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return JSON.parse(trimmed.slice(start, index + 1));
      }
    }
  }

  throw new Error("Failed to extract JSON object from specialist output");
}

function extractClaudePrintResult(raw: string): string {
  const parsed = JSON.parse(raw) as {
    result?: unknown;
  };
  return typeof parsed.result === "string" ? parsed.result : raw;
}

function listFilesRecursive(dir: string, predicate: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, predicate));
      continue;
    }
    if (entry.isFile() && predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function parseJavaStringConstants(content: string): Map<string, string> {
  const constants = new Map<string, string>();
  const regex = /\bString\s+([A-Z0-9_]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    constants.set(match[1] ?? "", match[2] ?? "");
  }

  return constants;
}

function resolveAnnotationString(
  raw: string | undefined,
  constants: Map<string, string>,
): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return stripSurroundingQuotes(trimmed);
  }

  if (constants.has(trimmed)) {
    return constants.get(trimmed) ?? null;
  }

  return null;
}

function extractAnnotationPath(
  args: string | undefined,
  constants: Map<string, string>,
): string {
  if (!args) {
    return "";
  }

  const keyValueMatch = args.match(/(?:value|path)\s*=\s*("[^"]*"|[A-Z0-9_]+)/u);
  if (keyValueMatch?.[1]) {
    return resolveAnnotationString(keyValueMatch[1], constants) ?? "";
  }

  const directMatch = args.match(/^\s*("[^"]*"|[A-Z0-9_]+)\s*$/u);
  if (directMatch?.[1]) {
    return resolveAnnotationString(directMatch[1], constants) ?? "";
  }

  return "";
}

function extractRequestMethods(args: string | undefined): string[] {
  if (!args) {
    return ["GET"];
  }

  const methods = [...args.matchAll(/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);

  return methods.length > 0 ? [...new Set(methods)] : ["GET"];
}

function extractClassHeader(content: string): { annotations: string; controllerName: string } {
  const match = content.match(/((?:@\w+(?:\([^)]*\))?\s*)*)public\s+class\s+(\w+)/su);
  if (!match?.[2]) {
    throw new Error("Unable to parse Spring controller class declaration");
  }

  return {
    annotations: match[1] ?? "",
    controllerName: match[2],
  };
}

function extractMappingAnnotations(
  annotationBlock: string,
  constants: Map<string, string>,
): Array<{ method: string; path: string }> {
  const mappings: Array<{ method: string; path: string }> = [];
  const annotationRegex = /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)(?:\(([^)]*)\))?/g;
  let match: RegExpExecArray | null;

  while ((match = annotationRegex.exec(annotationBlock)) !== null) {
    const annotationName = match[1] ?? "";
    const args = match[2];
    const resolvedPath = extractAnnotationPath(args, constants);
    const methods = annotationName === "RequestMapping"
      ? extractRequestMethods(args)
      : [annotationName.replace("Mapping", "").toUpperCase()];

    for (const method of methods) {
      mappings.push({
        method,
        path: resolvedPath,
      });
    }
  }

  return mappings;
}

function joinRoutePaths(basePath: string, methodPath: string): string {
  const normalizedBase = basePath.trim();
  const normalizedMethod = methodPath.trim();

  const segments = [normalizedBase, normalizedMethod]
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter(Boolean);

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

function extractMethodBody(content: string, bodyStartIndex: number): string {
  let depth = 0;
  let cursor = bodyStartIndex;

  while (cursor < content.length) {
    const char = content[cursor];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(bodyStartIndex + 1, cursor);
      }
    }
    cursor += 1;
  }

  return "";
}

function pickTemplateName(body: string): string | null {
  const candidates = [
    ...[...body.matchAll(/new\s+ModelAndView\(\s*"([^"]+)"/g)].map((match) => match[1] ?? ""),
    ...[...body.matchAll(/return\s+"([^"]+)"\s*;/g)].map((match) => match[1] ?? ""),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith("redirect:"))
    .map((value) => value.replace(/^\/+/u, ""));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.find((value) => value !== "error") ?? candidates[0] ?? null;
}

function inferTemplateTitle(templatePath: string | null, fallbackName: string): string {
  if (templatePath && fs.existsSync(templatePath)) {
    const content = fs.readFileSync(templatePath, "utf8");
    const titleMatch = content.match(/<title>([^<]+)<\/title>/iu);
    if (titleMatch?.[1]) {
      return titleMatch[1].trim();
    }

    const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/iu);
    if (h1Match?.[1]) {
      return h1Match[1].trim();
    }
  }

  return humanizeIdentifier(fallbackName);
}

function buildOperationSummary(route: SpringControllerRoute): string {
  if (route.templateName && route.httpMethod === "GET") {
    return `Render ${humanizeIdentifier(route.templateName)}`;
  }

  return humanizeIdentifier(route.methodName);
}

function extractSpringControllerRoutes(repoRoot: string): SpringControllerRoute[] {
  const controllerFiles = listFilesRecursive(
    path.join(repoRoot, "src", "main", "java"),
    (filePath) => filePath.endsWith("Controller.java"),
  );
  const routes: SpringControllerRoute[] = [];

  for (const filePath of controllerFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const constants = parseJavaStringConstants(content);
    const { annotations, controllerName } = extractClassHeader(content);
    const classMappings = extractMappingAnnotations(annotations, constants);
    const classBasePath = classMappings[0]?.path ?? "";

    const methodRegex =
      /((?:@\w+(?:\((?:[^()]|\([^()]*\))*\))?\s*)+)\s*public\s+[A-Za-z0-9_<>,?.\[\]\s]+\s+(\w+)\s*\((?:[^()]|\([^()]*\))*\)\s*(?:throws\s+[A-Za-z0-9_<>,?.\[\]\s]+)?\s*\{/gs;
    let match: RegExpExecArray | null;

    while ((match = methodRegex.exec(content)) !== null) {
      const annotationBlock = match[1] ?? "";
      const methodName = match[2] ?? "";
      const mappings = extractMappingAnnotations(annotationBlock, constants);
      if (mappings.length === 0) {
        continue;
      }

      const bodyStartIndex = methodRegex.lastIndex - 1;
      const body = extractMethodBody(content, bodyStartIndex);
      const templateName = pickTemplateName(body);
      const templatePath = templateName
        ? path.join(repoRoot, "src", "main", "resources", "templates", `${templateName}.html`)
        : null;

      for (const mapping of mappings) {
        const route = joinRoutePaths(classBasePath, mapping.path);
        const controllerBase = controllerName.replace(/Controller$/u, "");
        routes.push({
          controllerName,
          methodName,
          httpMethod: mapping.method,
          route,
          sourceFile: toRepoRelative(repoRoot, filePath),
          summary: humanizeIdentifier(methodName),
          templateName,
          templateSourceFile:
            templatePath && fs.existsSync(templatePath)
              ? toRepoRelative(repoRoot, templatePath)
              : null,
        });
        void controllerBase;
      }
    }
  }

  return routes.sort((left, right) =>
    left.route.localeCompare(right.route)
    || left.httpMethod.localeCompare(right.httpMethod)
    || left.controllerName.localeCompare(right.controllerName),
  );
}

function inferSpringDomain(controllerName: string): string {
  return toKebabCase(controllerName.replace(/Controller$/u, "")) || "spring";
}

function createSpringPages(
  repoRoot: string,
  routes: SpringControllerRoute[],
): RouteInfo[] {
  const pageMap = new Map<string, RouteInfo>();

  for (const route of routes) {
    if (route.httpMethod !== "GET" || !route.templateName) {
      continue;
    }

    const sourceFile = route.templateSourceFile ?? route.sourceFile;
    const title = inferTemplateTitle(
      route.templateSourceFile
        ? path.join(repoRoot, route.templateSourceFile)
        : null,
      route.templateName,
    );
    pageMap.set(route.route, {
      route: route.route,
      title,
      description: `Spring MVC page served by ${route.controllerName}#${route.methodName}`,
      sourceFile,
    });
  }

  return [...pageMap.values()].sort((left, right) => left.route.localeCompare(right.route));
}

function createSpringContractApis(routes: SpringControllerRoute[]): ContractApiFeature[] {
  return routes.map((route) => ({
    domain: inferSpringDomain(route.controllerName),
    method: route.httpMethod,
    path: route.route,
    operationId: `${inferSpringDomain(route.controllerName)}.${route.methodName}`,
    summary: buildOperationSummary(route),
  }));
}

function createSpringImplementationApis(routes: SpringControllerRoute[]): ImplementationApiRoute[] {
  const apis = new Map<string, ImplementationApiRoute>();

  for (const route of routes) {
    const key = buildApiLookupKey(route.httpMethod, route.route);
    const existing = apis.get(key);
    if (existing) {
      existing.sourceFiles = [...new Set([...existing.sourceFiles, route.sourceFile])].sort();
      continue;
    }

    apis.set(key, {
      label: SPRING_IMPLEMENTATION_LABEL,
      domain: inferSpringDomain(route.controllerName),
      method: route.httpMethod,
      path: route.route,
      sourceFiles: [route.sourceFile],
    });
  }

  return [...apis.values()].sort((left, right) =>
    left.domain.localeCompare(right.domain)
    || left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method),
  );
}

function createMetadataSeed(
  repoRoot: string,
  overlayMetadata: FeatureMetadata | null = null,
): FeatureMetadata {
  return (
    mergeSurfaceMetadata(
      stripInferredSurfaceMetadata(loadPersistedFeatureMetadata(repoRoot)),
      overlayMetadata,
    )
    ?? { schemaVersion: 1, capabilityGroups: [], features: [] }
  );
}

function generateSpringBootFeatureTree(
  repoRoot: string,
  metadataSeed: FeatureMetadata | null = null,
): GeneratedFeatureTree {
  ensureSpringBootRepo(repoRoot);
  const { productName, productDescription } = parsePomMetadata(repoRoot);
  const routes = extractSpringControllerRoutes(repoRoot);
  const pages = createSpringPages(repoRoot, routes);
  const contractApis = createSpringContractApis(routes);
  const implementationApis = createSpringImplementationApis(routes);
  const metadata = normalizeSurfaceMetadata({
    metadata: metadataSeed ?? { schemaVersion: 1, capabilityGroups: [], features: [] },
    pages,
    contractApis,
    nextjsApis: [],
    rustApis: [],
    implementationApis,
  });

  return {
    framework: "spring-boot",
    productName,
    productDescription,
    sources: [
      "pom.xml",
      "src/main/java/**/*Controller.java",
      "src/main/resources/templates/**/*.html",
    ],
    pages,
    contractApis,
    implementationApis,
    metadata,
  };
}

function buildSurfaceIndex(result: GeneratedFeatureTree): FeatureSurfaceIndex {
  return {
    generatedAt: new Date().toISOString(),
    pages: result.pages.map((page) => ({
      route: page.route,
      title: page.title,
      description: page.description,
      sourceFile: page.sourceFile,
    })),
    apis: result.contractApis.map((api) => ({ ...api })),
    contractApis: result.contractApis.map((api) => ({ ...api })),
    nextjsApis: [],
    rustApis: [],
    implementationApis: result.implementationApis.map((api) => ({
      label: api.label,
      domain: api.domain,
      method: api.method,
      path: api.path,
      sourceFiles: [...api.sourceFiles],
    })),
    metadata: result.metadata,
  };
}

function formatSourceFiles(sourceFiles: string[]): string {
  if (sourceFiles.length === 0) {
    return "";
  }

  return sourceFiles.map((file) => `\`${file}\``).join(", ");
}

function buildPreferredApiDeclarations(surfaceIndex: FeatureSurfaceIndex): Map<string, string> {
  const preferred = new Map<string, string>();
  const upsert = (method: string, endpointPath: string) => {
    preferred.set(buildApiLookupKey(method, endpointPath), `${method.toUpperCase()} ${endpointPath}`);
  };

  for (const api of surfaceIndex.contractApis) {
    upsert(api.method, api.path);
  }
  for (const api of surfaceIndex.implementationApis) {
    const key = buildApiLookupKey(api.method, api.path);
    if (!preferred.has(key)) {
      upsert(api.method, api.path);
    }
  }

  return preferred;
}

function buildFrontmatterMetadata(
  metadata: FeatureMetadata,
  surfaceIndex: FeatureSurfaceIndex,
): string {
  const preferredDeclarations = buildPreferredApiDeclarations(surfaceIndex);
  const featureLines = metadata.features.map((feature) => {
    const normalizedApis = (feature.apis ?? [])
      .map((declaration) => {
        const [method = "GET", endpointPath = declaration.trim()] = declaration.trim().split(/\s+/, 2);
        return preferredDeclarations.get(buildApiLookupKey(method, endpointPath)) ?? declaration.trim();
      })
      .filter(Boolean)
      .sort();

    const lines = [
      "    - id: " + feature.id,
      "      name: " + JSON.stringify(feature.name),
    ];

    if (feature.group) lines.push(`      group: ${feature.group}`);
    if (feature.summary) lines.push(`      summary: ${JSON.stringify(feature.summary)}`);
    if (feature.status) lines.push(`      status: ${feature.status}`);
    if (feature.pages?.length) {
      lines.push("      pages:");
      for (const page of feature.pages) {
        lines.push(`        - ${page}`);
      }
    }
    if (normalizedApis.length > 0) {
      lines.push("      apis:");
      for (const api of normalizedApis) {
        lines.push(`        - ${JSON.stringify(api)}`);
      }
    }
    if (feature.domainObjects?.length) {
      lines.push("      domain_objects:");
      for (const domainObject of feature.domainObjects) {
        lines.push(`        - ${domainObject}`);
      }
    }
    if (feature.relatedFeatures?.length) {
      lines.push("      related_features:");
      for (const relatedFeature of feature.relatedFeatures) {
        lines.push(`        - ${relatedFeature}`);
      }
    }
    if (feature.sourceFiles?.length) {
      lines.push("      source_files:");
      for (const sourceFile of feature.sourceFiles) {
        lines.push(`        - ${sourceFile}`);
      }
    }

    return lines.join("\n");
  });

  const groupLines = metadata.capabilityGroups.map((group) => {
    const lines = [
      `    - id: ${group.id}`,
      `      name: ${JSON.stringify(group.name)}`,
    ];
    if (group.description) {
      lines.push(`      description: ${JSON.stringify(group.description)}`);
    }
    return lines.join("\n");
  });

  const lines = [
    "feature_metadata:",
    `  schema_version: ${metadata.schemaVersion}`,
  ];

  if (groupLines.length > 0) {
    lines.push("  capability_groups:", ...groupLines);
  } else {
    lines.push("  capability_groups: []");
  }

  if (featureLines.length > 0) {
    lines.push("  features:", ...featureLines);
  } else {
    lines.push("  features: []");
  }

  return lines.join("\n");
}

export function renderFeatureTreeMarkdown(
  result: GeneratedFeatureTree,
  surfaceIndex: FeatureSurfaceIndex,
  repoRoot: string,
): string {
  const implementationLabels = [...new Set(surfaceIndex.implementationApis.map((api) => api.label))].sort();
  const groupByDomain = <T extends { domain: string }>(items: T[]): Array<[string, T[]]> => {
    const grouped = new Map<string, T[]>();

    for (const item of items) {
      const domain = item.domain.trim() || "general";
      const existing = grouped.get(domain);
      if (existing) {
        existing.push(item);
      } else {
        grouped.set(domain, [item]);
      }
    }

    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  };

  const lines = [
    "---",
    "status: generated",
    `framework: ${result.framework}`,
    `purpose: ${JSON.stringify(`Auto-generated surface index for ${result.productName}.`)}`,
    "sources:",
    ...result.sources.map((source) => `  - ${source}`),
    "update_policy:",
    `  - ${JSON.stringify(`Regenerate with \`node --import tsx ${GENERATOR_PATH} --repo-root ${repoRoot} --save\`.`)}`,
    "  - \"Hand-edit semantic `feature_metadata` fields in this frontmatter block.\"",
    "  - \"Do not hand-edit generated route or endpoint tables below.\"",
  ];

  if (surfaceIndex.metadata) {
    lines.push(buildFrontmatterMetadata(surfaceIndex.metadata, surfaceIndex));
  }

  lines.push(
    "---",
    "",
    `# ${result.productName} — Product Feature Specification`,
    "",
    `${result.productDescription}. This document is auto-generated from:`,
    ...result.sources.map((source) => `- \`${source}\``),
    "",
    "---",
    "",
    "## Frontend Pages",
    "",
    "| Page | Route | Source File | Description |",
    "|------|-------|-------------|-------------|",
  );

  for (const page of surfaceIndex.pages) {
    lines.push(
      `| ${page.title} | \`${page.route}\` | \`${page.sourceFile}\` | ${page.description} |`,
    );
  }

  lines.push("", "---", "", "## API Contract Endpoints");

  for (const [domain, apis] of groupByDomain(surfaceIndex.contractApis)) {
    lines.push(
      "",
      `### ${humanizeIdentifier(domain)} (${apis.length})`,
      "",
      "| Method | Endpoint | Details |",
      "|--------|----------|---------|",
    );

    for (const api of apis) {
      lines.push(
        `| ${api.method} | \`${api.path}\` | ${api.summary || api.operationId} |`,
      );
    }
  }

  for (const label of implementationLabels) {
    const heading = label === SPRING_IMPLEMENTATION_LABEL ? "Spring MVC" : humanizeIdentifier(label);
    lines.push("", "---", "", `## ${heading} API Routes`);

    const implementationApis = surfaceIndex.implementationApis
      .filter((api) => api.label === label);
    for (const [domain, apis] of groupByDomain(implementationApis)) {
      lines.push(
        "",
        `### ${humanizeIdentifier(domain)} (${apis.length})`,
        "",
        "| Method | Endpoint | Source Files |",
        "|--------|----------|--------------|",
      );

      for (const api of apis) {
        lines.push(
          `| ${api.method} | \`${api.path}\` | ${formatSourceFiles(api.sourceFiles)} |`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function generateFeatureTreeForRepo(repoRoot: string): GeneratedFeatureTree {
  return generateSpringBootFeatureTree(repoRoot, createMetadataSeed(repoRoot));
}

export function generateSurfaceIndexForRepo(repoRoot: string): FeatureSurfaceIndex {
  return buildSurfaceIndex(generateFeatureTreeForRepo(repoRoot));
}

type SurfaceIndexValidationResult = {
  errors: string[];
  warnings: string[];
};

export function validateSurfaceIndex(surfaceIndex: FeatureSurfaceIndex): SurfaceIndexValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pageRoutes = new Set<string>();
  const contractApiKeys = new Set<string>();
  const implementationApiKeys = new Set<string>();

  for (const page of surfaceIndex.pages) {
    if (pageRoutes.has(page.route)) {
      errors.push(`Duplicate page route "${page.route}".`);
    }
    pageRoutes.add(page.route);
    if (!page.sourceFile) {
      warnings.push(`Page "${page.route}" is missing a source file.`);
    }
  }

  for (const api of surfaceIndex.contractApis) {
    const key = buildApiLookupKey(api.method, api.path);
    if (contractApiKeys.has(key)) {
      errors.push(`Duplicate contract api "${api.method} ${api.path}".`);
    }
    contractApiKeys.add(key);
  }

  for (const api of surfaceIndex.implementationApis) {
    const key = `${api.label}:${buildApiLookupKey(api.method, api.path)}`;
    if (implementationApiKeys.has(key)) {
      errors.push(`Duplicate implementation api "${api.label}:${api.method} ${api.path}".`);
    }
    implementationApiKeys.add(key);
    if (api.sourceFiles.length === 0) {
      warnings.push(`Implementation api "${api.method} ${api.path}" has no source files.`);
    }
  }

  const metadataValidation = validateSurfaceMetadata({
    metadata: surfaceIndex.metadata,
    pages: surfaceIndex.pages,
    contractApis: surfaceIndex.contractApis,
    nextjsApis: surfaceIndex.nextjsApis,
    rustApis: surfaceIndex.rustApis,
    implementationApis: surfaceIndex.implementationApis,
  });
  errors.push(...metadataValidation.errors);
  warnings.push(...metadataValidation.warnings);

  return {
    errors: [...new Set(errors)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

function assertValidSurfaceIndex(surfaceIndex: FeatureSurfaceIndex): void {
  const validation = validateSurfaceIndex(surfaceIndex);
  if (validation.errors.length > 0) {
    throw new Error(
      `Generated surface index is invalid:\n- ${validation.errors.join("\n- ")}`,
    );
  }
}

function writeSurfaceArtifacts(
  repoRoot: string,
  result: GeneratedFeatureTree,
  surfaceIndex: FeatureSurfaceIndex,
  silent = false,
): void {
  const markdown = renderFeatureTreeMarkdown(result, surfaceIndex, repoRoot);
  const mdPath = path.join(repoRoot, OUTPUT_MD_RELATIVE);
  const jsonPath = path.join(repoRoot, OUTPUT_JSON_RELATIVE);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, markdown, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(surfaceIndex, null, 2) + "\n", "utf8");
  if (!silent) {
    console.log(`✅ Saved to ${mdPath}`);
    console.log(`✅ Saved to ${jsonPath}`);
  }
}

function runSpecialistForMetadata(args: {
  repoRoot: string;
  surfaceIndex: FeatureSurfaceIndex;
  specialistPath: string;
  specialistProvider: string | null;
  specialistPrompt: string | null;
  routaBin: string;
  routaDbPath: string;
}): FeatureMetadata {
  const normalizeMetadataResult = (raw: string): FeatureMetadata => {
    const metadata = normalizeFeatureMetadata(extractJsonObject(raw));
    if (!metadata) {
      throw new Error(`Specialist output from ${args.specialistPath} is not valid feature metadata JSON`);
    }
    return metadata;
  };

  const runClaudeFallback = (): FeatureMetadata => {
    const specialistRaw = fs.readFileSync(args.specialistPath, "utf8");
    const systemPrompt = readLiteralYamlBlock(specialistRaw, "system_prompt");
    const roleReminder = readQuotedYamlScalar(specialistRaw, "role_reminder");
    const relevantFiles = [
      "pom.xml",
      ...args.surfaceIndex.pages.map((page) => page.sourceFile),
      ...args.surfaceIndex.implementationApis.flatMap((api) => api.sourceFiles),
    ];
    const uniqueRelevantFiles = [...new Set(relevantFiles)]
      .filter(Boolean)
      .slice(0, 18);
    const fileContext = uniqueRelevantFiles.map((relativePath) => {
      const absolutePath = path.join(args.repoRoot, relativePath);
      const content = fs.existsSync(absolutePath)
        ? fs.readFileSync(absolutePath, "utf8").slice(0, 4000)
        : "[missing]";
      return [
        `### ${relativePath}`,
        "```",
        content,
        "```",
      ].join("\n");
    }).join("\n\n");
    const promptSections = [
      systemPrompt,
      roleReminder,
      args.specialistPrompt ?? DEFAULT_SPECIALIST_PROMPT,
      "Repository surface index:",
      JSON.stringify(args.surfaceIndex, null, 2),
      "Relevant repository files:",
      fileContext,
      "Return strict JSON only. Do not wrap the answer in markdown fences or any prose.",
    ].filter(Boolean);
    try {
      const raw = execFileSync("claude", [
        "-p",
        "--bare",
        "--no-session-persistence",
        "--dangerously-skip-permissions",
        "--output-format",
        "json",
        "--tools",
        "",
        "--system-prompt",
        promptSections.join("\n\n"),
        "Analyze the provided repository context and return the required feature metadata JSON now.",
      ], {
        cwd: args.repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
      return normalizeMetadataResult(extractClaudePrintResult(raw));
    } catch (error) {
      const stdout = error instanceof Error && "stdout" in error
        ? String((error as { stdout?: unknown }).stdout ?? "")
        : "";
      if (stdout.trim()) {
        return normalizeMetadataResult(extractClaudePrintResult(stdout));
      }
      throw error;
    }
  };

  const commandArgs = [
    "--db",
    args.routaDbPath,
    "specialist",
    "run",
    args.specialistPath,
    "--provider-timeout-ms",
    "120000",
    "--provider-retries",
    "1",
    "--json",
    "-p",
    args.specialistPrompt ?? DEFAULT_SPECIALIST_PROMPT,
  ];
  if (args.specialistProvider) {
    commandArgs.push("--provider", args.specialistProvider);
  }

  if (args.specialistProvider === "claude") {
    return runClaudeFallback();
  }

  try {
    const raw = execFileSync(args.routaBin, commandArgs, {
      cwd: args.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return normalizeMetadataResult(raw);
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "")
      : "";
    if (args.specialistProvider === "claude" && /session_idle_timeout/u.test(stderr)) {
      return runClaudeFallback();
    }
    throw error;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const metadataFromFile = loadMetadataFromJsonFile(args.metadataJsonPath);
  let metadataSeed = createMetadataSeed(args.repoRoot, metadataFromFile);
  let result = generateSpringBootFeatureTree(args.repoRoot, metadataSeed);
  let surfaceIndex = buildSurfaceIndex(result);
  assertValidSurfaceIndex(surfaceIndex);

  if (args.specialistPath) {
    writeSurfaceArtifacts(args.repoRoot, result, surfaceIndex, args.json);
    const specialistMetadata = runSpecialistForMetadata({
      repoRoot: args.repoRoot,
      surfaceIndex,
      specialistPath: args.specialistPath,
      specialistProvider: args.specialistProvider,
      specialistPrompt: args.specialistPrompt,
      routaBin: args.routaBin,
      routaDbPath: args.routaDbPath,
    });
    metadataSeed = mergeSurfaceMetadata(metadataSeed, specialistMetadata)
      ?? { schemaVersion: 1, capabilityGroups: [], features: [] };
    result = generateSpringBootFeatureTree(args.repoRoot, metadataSeed);
    surfaceIndex = buildSurfaceIndex(result);
    assertValidSurfaceIndex(surfaceIndex);
  }

  if (args.json) {
    console.log(JSON.stringify(surfaceIndex, null, 2));
    return;
  }

  if (args.save) {
    writeSurfaceArtifacts(args.repoRoot, result, surfaceIndex, args.json);
    return;
  }

  const markdown = renderFeatureTreeMarkdown(result, surfaceIndex, args.repoRoot);
  console.log(markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
