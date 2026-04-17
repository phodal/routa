#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import featureSurfaceMetadata from "../../src/core/spec/feature-surface-metadata";

const { buildApiLookupKey, normalizeSurfaceMetadata } = featureSurfaceMetadata;

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
    throw new Error(`Unknown argument: ${value}`);
  }

  return { repoRoot, save, json };
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

function generateSpringBootFeatureTree(repoRoot: string): GeneratedFeatureTree {
  ensureSpringBootRepo(repoRoot);
  const { productName, productDescription } = parsePomMetadata(repoRoot);
  const persistedMetadata = loadPersistedFeatureMetadata(repoRoot);
  const routes = extractSpringControllerRoutes(repoRoot);
  const pages = createSpringPages(repoRoot, routes);
  const contractApis = createSpringContractApis(routes);
  const implementationApis = createSpringImplementationApis(routes);
  const metadataSeed = normalizeFeatureMetadata(
    persistedMetadata ?? { schemaVersion: 1, capabilityGroups: [], features: [] },
  );
  const metadata = normalizeSurfaceMetadata({
    metadata: metadataSeed,
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

function renderMarkdown(
  result: GeneratedFeatureTree,
  surfaceIndex: FeatureSurfaceIndex,
  repoRoot: string,
): string {
  const implementationLabels = [...new Set(surfaceIndex.implementationApis.map((api) => api.label))];
  const implementationLookups = new Map(
    implementationLabels.map((label) => [
      label,
      new Map(
        surfaceIndex.implementationApis
          .filter((api) => api.label === label)
          .map((api) => [buildApiLookupKey(api.method, api.path), api.sourceFiles]),
      ),
    ]),
  );
  const implementationHeaders = implementationLabels.map((label) =>
    label === SPRING_IMPLEMENTATION_LABEL ? "Spring MVC" : humanizeIdentifier(label),
  );

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

  lines.push("", "---", "", "## HTTP Contract Endpoints", "");
  const headerCells = ["Method", "Endpoint", "Details", ...implementationHeaders];
  const separatorCells = headerCells.map(() => "--------");
  lines.push(
    `| ${headerCells.join(" | ")} |`,
    `| ${separatorCells.join(" | ")} |`,
  );

  for (const api of surfaceIndex.contractApis) {
    const lookupKey = buildApiLookupKey(api.method, api.path);
    const sourceColumns = implementationLabels.map((label) =>
      formatSourceFiles(implementationLookups.get(label)?.get(lookupKey) ?? []),
    );
    lines.push(
      `| ${api.method} | \`${api.path}\` | ${api.summary || api.operationId} | ${sourceColumns.join(" | ")} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function generateFeatureTreeForRepo(repoRoot: string): GeneratedFeatureTree {
  return generateSpringBootFeatureTree(repoRoot);
}

export function generateSurfaceIndexForRepo(repoRoot: string): FeatureSurfaceIndex {
  return buildSurfaceIndex(generateFeatureTreeForRepo(repoRoot));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = generateFeatureTreeForRepo(args.repoRoot);
  const surfaceIndex = buildSurfaceIndex(result);

  if (args.json) {
    console.log(JSON.stringify(surfaceIndex, null, 2));
    return;
  }

  const markdown = renderMarkdown(result, surfaceIndex, args.repoRoot);
  if (args.save) {
    const mdPath = path.join(args.repoRoot, OUTPUT_MD_RELATIVE);
    const jsonPath = path.join(args.repoRoot, OUTPUT_JSON_RELATIVE);
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, markdown, "utf8");
    fs.writeFileSync(jsonPath, JSON.stringify(surfaceIndex, null, 2) + "\n", "utf8");
    console.log(`✅ Saved to ${mdPath}`);
    console.log(`✅ Saved to ${jsonPath}`);
    return;
  }

  console.log(markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
