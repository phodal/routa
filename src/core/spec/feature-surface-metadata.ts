export type SurfaceMetadataGroup = {
  id: string;
  name: string;
  description?: string;
};

export type SurfaceMetadataFeature = {
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

export type SurfaceMetadata = {
  schemaVersion: number;
  capabilityGroups: SurfaceMetadataGroup[];
  features: SurfaceMetadataFeature[];
};

export type SurfacePage = {
  route: string;
  title: string;
  description?: string;
  sourceFile: string;
};

export type SurfaceContractApi = {
  domain: string;
  method: string;
  path: string;
  summary?: string;
  operationId?: string;
};

export type SurfaceImplementationApi = {
  domain: string;
  method: string;
  path: string;
  sourceFiles: string[];
};

type SurfaceApiEntry = {
  declaration: string;
  domain: string;
  method: string;
  path: string;
  summary: string;
  sourceFiles: string[];
};

type InferredFeatureCluster = {
  key: string;
  pages: Set<string>;
  apis: Set<string>;
  sourceFiles: Set<string>;
};

export const INFERRED_GROUP_ID = "inferred-surfaces";
export const INFERRED_GROUP_NAME = "Inferred Surfaces";

const PATH_STOPWORDS = new Set([
  "api",
  "app",
  "apps",
  "client",
  "clients",
  "component",
  "components",
  "controller",
  "controllers",
  "crates",
  "handler",
  "handlers",
  "index",
  "lib",
  "libs",
  "main",
  "page",
  "pages",
  "route",
  "routes",
  "server",
  "servers",
  "service",
  "services",
  "src",
  "view",
  "views",
  "web",
  "www",
]);

function normalizeToken(value: string): string {
  return value
    .trim()
    .replace(/^\[+|\]+$/g, "")
    .replace(/^\{+|\}+$/g, "")
    .replace(/^:+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
}

export function buildApiLookupKey(method: string, endpointPath: string): string {
  const normalizedPath = endpointPath
    .trim()
    .replace(/:[A-Za-z0-9_]+/g, "{}")
    .replace(/\{[^}]+\}/g, "{}");
  return `${method.trim().toUpperCase()} ${normalizedPath}`;
}

export function buildApiDeclaration(method: string, endpointPath: string): string {
  return buildApiLookupKey(method, endpointPath);
}

function splitMeaningfulTokens(value: string): string[] {
  return value
    .split(/[\\/]/)
    .flatMap((segment) => segment.split(/[^a-zA-Z0-9:{}_\\[\\]-]+/))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(":"))
    .filter((segment) => !(segment.startsWith("{") && segment.endsWith("}")))
    .filter((segment) => !(segment.startsWith("[") && segment.endsWith("]")))
    .map(normalizeToken)
    .filter(Boolean)
    .filter((segment) => !PATH_STOPWORDS.has(segment));
}

function inferFeatureKeyFromPage(page: SurfacePage): string {
  if (page.route === "/") {
    return "home";
  }

  const routeSegments = page.route
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(":"))
    .filter((segment) => !(segment.startsWith("{") && segment.endsWith("}")))
    .map(normalizeToken)
    .filter(Boolean);

  if (routeSegments.length > 0) {
    return routeSegments.at(-1) ?? routeSegments[0] ?? "page";
  }

  const sourceTokens = splitMeaningfulTokens(page.sourceFile);
  return sourceTokens.at(-1) ?? "page";
}

function inferFeatureKeyFromApi(api: Pick<SurfaceApiEntry, "domain" | "path" | "sourceFiles">): string {
  const normalizedDomain = normalizeToken(api.domain);
  if (normalizedDomain) {
    return normalizedDomain;
  }

  const pathSegments = api.path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== "api")
    .filter((segment) => !(segment.startsWith("{") && segment.endsWith("}")))
    .map(normalizeToken)
    .filter(Boolean);
  if (pathSegments.length > 0) {
    return pathSegments[0] ?? "api";
  }

  const sourceTokens = api.sourceFiles.flatMap(splitMeaningfulTokens);
  return sourceTokens.at(-1) ?? "api";
}

function humanizeSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (/^[a-z0-9]{1,4}$/iu.test(part)) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function apiDeclarationSpecificity(declaration: string): number {
  const placeholderMatches = declaration.match(/\{[A-Za-z0-9_]+\}|:[A-Za-z0-9_]+/g) ?? [];
  return placeholderMatches.reduce((score, match) => score + match.length, 0);
}

function upsertApiDeclaration(store: Map<string, string>, declaration: string): boolean {
  const [method = "GET", endpointPath = declaration.trim()] = declaration.trim().split(/\s+/, 2);
  const lookupKey = buildApiLookupKey(method, endpointPath);
  const existing = store.get(lookupKey);
  if (!existing || apiDeclarationSpecificity(declaration) > apiDeclarationSpecificity(existing)) {
    store.set(lookupKey, declaration.trim());
    return true;
  }
  return false;
}

function buildSurfaceApiEntries(
  contractApis: SurfaceContractApi[],
  nextjsApis: SurfaceImplementationApi[],
  rustApis: SurfaceImplementationApi[],
  implementationApis: SurfaceImplementationApi[] = [],
): SurfaceApiEntry[] {
  const entries = new Map<string, SurfaceApiEntry>();

  const ensureEntry = (params: {
    domain: string;
    method: string;
    path: string;
    summary?: string;
    sourceFiles?: string[];
  }): SurfaceApiEntry => {
    const key = buildApiLookupKey(params.method, params.path);
    const existing = entries.get(key);
    if (existing) {
      existing.sourceFiles = uniqueSorted([...existing.sourceFiles, ...(params.sourceFiles ?? [])]);
      if (!existing.summary && params.summary) {
        existing.summary = params.summary;
      }
      if (!existing.domain && params.domain) {
        existing.domain = params.domain;
      }
      return existing;
    }

    const created: SurfaceApiEntry = {
      declaration: buildApiDeclaration(params.method, params.path),
      domain: params.domain.trim(),
      method: params.method.trim().toUpperCase(),
      path: params.path.trim(),
      summary: params.summary?.trim() ?? "",
      sourceFiles: uniqueSorted(params.sourceFiles ?? []),
    };
    entries.set(key, created);
    return created;
  };

  for (const api of contractApis) {
    ensureEntry(api);
  }
  for (const api of nextjsApis) {
    ensureEntry(api);
  }
  for (const api of rustApis) {
    ensureEntry(api);
  }
  for (const api of implementationApis) {
    ensureEntry(api);
  }

  return [...entries.values()].sort((left, right) =>
    left.domain.localeCompare(right.domain)
    || left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method));
}

function buildAugmentedFeature(
  feature: SurfaceMetadataFeature,
  pages: SurfacePage[],
  apis: SurfaceApiEntry[],
): SurfaceMetadataFeature {
  const pageByRoute = new Map(pages.map((page) => [page.route, page]));
  const apiByLookupKey = new Map(apis.map((api) => [buildApiLookupKey(api.method, api.path), api]));
  const canonicalizeApiDeclaration = (declaration: string): string => {
    const [method = "GET", endpointPath = declaration.trim()] = declaration.trim().split(/\s+/, 2);
    return apiByLookupKey.get(buildApiLookupKey(method, endpointPath))?.declaration ?? declaration.trim();
  };
  const sourceFiles = new Set(feature.sourceFiles ?? []);
  const declaredPages = new Set(feature.pages ?? []);
  const declaredApis = new Map<string, string>();
  for (const declaration of feature.apis ?? []) {
    upsertApiDeclaration(declaredApis, canonicalizeApiDeclaration(declaration));
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const route of [...declaredPages]) {
      const page = pageByRoute.get(route);
      if (page?.sourceFile && !sourceFiles.has(page.sourceFile)) {
        sourceFiles.add(page.sourceFile);
        changed = true;
      }
    }

    for (const declaration of [...declaredApis.values()]) {
      const [method = "GET", endpointPath = declaration.trim()] = declaration.trim().split(/\s+/, 2);
      const lookupKey = buildApiLookupKey(method, endpointPath);
      const api = apiByLookupKey.get(lookupKey);
      if (!api) {
        continue;
      }
      changed = upsertApiDeclaration(declaredApis, canonicalizeApiDeclaration(api.declaration)) || changed;
      for (const sourceFile of api.sourceFiles) {
        if (!sourceFiles.has(sourceFile)) {
          sourceFiles.add(sourceFile);
          changed = true;
        }
      }
    }

    for (const page of pages) {
      if (page.sourceFile && sourceFiles.has(page.sourceFile) && !declaredPages.has(page.route)) {
        declaredPages.add(page.route);
        changed = true;
      }
    }

    for (const api of apis) {
      if (api.sourceFiles.length === 0) {
        continue;
      }
      if (api.sourceFiles.some((sourceFile) => sourceFiles.has(sourceFile))) {
        changed = upsertApiDeclaration(declaredApis, canonicalizeApiDeclaration(api.declaration)) || changed;
      }
    }
  }

  return {
    ...feature,
    ...(feature.group ? { group: feature.group } : {}),
    ...(feature.summary ? { summary: feature.summary } : {}),
    ...(feature.status ? { status: feature.status } : {}),
    ...(declaredPages.size > 0 ? { pages: uniqueSorted(declaredPages) } : {}),
    ...(declaredApis.size > 0
      ? { apis: uniqueSorted([...declaredApis.values()].map((declaration) => canonicalizeApiDeclaration(declaration))) }
      : {}),
    ...(feature.domainObjects?.length ? { domainObjects: uniqueSorted(feature.domainObjects) } : {}),
    ...(feature.relatedFeatures?.length ? { relatedFeatures: uniqueSorted(feature.relatedFeatures) } : {}),
    ...(feature.screenshots?.length ? { screenshots: uniqueSorted(feature.screenshots) } : {}),
    ...(sourceFiles.size > 0 ? { sourceFiles: uniqueSorted(sourceFiles) } : {}),
  };
}

function createInferredFeatures(
  features: SurfaceMetadataFeature[],
  pages: SurfacePage[],
  apis: SurfaceApiEntry[],
): SurfaceMetadataFeature[] {
  const assignedPageRoutes = new Set<string>();
  const assignedApiDeclarations = new Set<string>();

  for (const feature of features) {
    for (const route of feature.pages ?? []) {
      assignedPageRoutes.add(route);
    }
    for (const declaration of feature.apis ?? []) {
      assignedApiDeclarations.add(declaration);
    }
  }

  const clusters = new Map<string, InferredFeatureCluster>();
  const ensureCluster = (key: string): InferredFeatureCluster => {
    const normalizedKey = normalizeToken(key) || "surface";
    const existing = clusters.get(normalizedKey);
    if (existing) {
      return existing;
    }
    const created: InferredFeatureCluster = {
      key: normalizedKey,
      pages: new Set<string>(),
      apis: new Set<string>(),
      sourceFiles: new Set<string>(),
    };
    clusters.set(normalizedKey, created);
    return created;
  };

  for (const page of pages) {
    if (assignedPageRoutes.has(page.route)) {
      continue;
    }
    const cluster = ensureCluster(inferFeatureKeyFromPage(page));
    cluster.pages.add(page.route);
    if (page.sourceFile) {
      cluster.sourceFiles.add(page.sourceFile);
    }
  }

  for (const api of apis) {
    if (assignedApiDeclarations.has(api.declaration)) {
      continue;
    }
    const cluster = ensureCluster(inferFeatureKeyFromApi(api));
    cluster.apis.add(api.declaration);
    for (const sourceFile of api.sourceFiles) {
      cluster.sourceFiles.add(sourceFile);
    }
  }

  const usedIds = new Set(features.map((feature) => feature.id));
  const inferred: SurfaceMetadataFeature[] = [];

  for (const cluster of [...clusters.values()].sort((left, right) => left.key.localeCompare(right.key))) {
    if (cluster.pages.size === 0 && cluster.apis.size === 0) {
      continue;
    }

    let id = cluster.key;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${cluster.key}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const pageCount = cluster.pages.size;
    const apiCount = cluster.apis.size;
    const summaryParts: string[] = [];
    if (pageCount > 0) {
      summaryParts.push(`${pageCount} page${pageCount === 1 ? "" : "s"}`);
    }
    if (apiCount > 0) {
      summaryParts.push(`${apiCount} API${apiCount === 1 ? "" : "s"}`);
    }

    inferred.push({
      id,
      name: humanizeSlug(cluster.key),
      group: INFERRED_GROUP_ID,
      summary: `Auto-inferred from FEATURE_TREE surfaces (${summaryParts.join(", ")}).`,
      status: "inferred",
      ...(cluster.pages.size > 0 ? { pages: uniqueSorted(cluster.pages) } : {}),
      ...(cluster.apis.size > 0 ? { apis: uniqueSorted(cluster.apis) } : {}),
      ...(cluster.sourceFiles.size > 0 ? { sourceFiles: uniqueSorted(cluster.sourceFiles) } : {}),
    });
  }

  return inferred;
}

function reconcileFeatureApiDeclarations(
  features: SurfaceMetadataFeature[],
  apis: SurfaceApiEntry[],
): SurfaceMetadataFeature[] {
  const canonicalDeclarations = new Map<string, string>();
  for (const api of apis) {
    upsertApiDeclaration(canonicalDeclarations, api.declaration);
  }

  return features.map((feature) => {
    if (!feature.apis?.length) {
      return feature;
    }

    const reconciled = new Map<string, string>();
    for (const declaration of feature.apis) {
      const [method = "GET", endpointPath = declaration.trim()] = declaration.trim().split(/\s+/, 2);
      const canonical = canonicalDeclarations.get(buildApiLookupKey(method, endpointPath)) ?? declaration.trim();
      upsertApiDeclaration(reconciled, canonical);
    }

    return {
      ...feature,
      apis: uniqueSorted(reconciled.values()),
    };
  });
}

export function normalizeSurfaceMetadata(params: {
  metadata: SurfaceMetadata | null;
  pages: SurfacePage[];
  contractApis: SurfaceContractApi[];
  nextjsApis: SurfaceImplementationApi[];
  rustApis: SurfaceImplementationApi[];
  implementationApis?: SurfaceImplementationApi[];
}): SurfaceMetadata | null {
  const {
    metadata,
    pages,
    contractApis,
    nextjsApis,
    rustApis,
    implementationApis = [],
  } = params;
  if (!metadata) {
    return null;
  }

  const apiEntries = buildSurfaceApiEntries(
    contractApis,
    nextjsApis,
    rustApis,
    implementationApis,
  );
  const augmentedFeatures = reconcileFeatureApiDeclarations(
    metadata.features.map((feature) => buildAugmentedFeature(feature, pages, apiEntries)),
    apiEntries,
  );
  const inferredFeatures = createInferredFeatures(augmentedFeatures, pages, apiEntries);
  const capabilityGroups = [...metadata.capabilityGroups];

  if (
    inferredFeatures.length > 0
    && !capabilityGroups.some((group) => group.id === INFERRED_GROUP_ID)
  ) {
    capabilityGroups.push({
      id: INFERRED_GROUP_ID,
      name: INFERRED_GROUP_NAME,
      description: "Auto-inferred surface clusters derived from generated page and API tables.",
    });
  }

  return {
    schemaVersion: metadata.schemaVersion,
    capabilityGroups,
    features: [...augmentedFeatures, ...inferredFeatures],
  };
}

export default {
  INFERRED_GROUP_ID,
  INFERRED_GROUP_NAME,
  buildApiDeclaration,
  buildApiLookupKey,
  normalizeSurfaceMetadata,
};
