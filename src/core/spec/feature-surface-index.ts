import { promises as fsp } from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import featureSurfaceMetadata from "./feature-surface-metadata";

const { normalizeSurfaceMetadata } = featureSurfaceMetadata;

export type FeatureSurfacePage = {
  route: string;
  title: string;
  description: string;
  sourceFile: string;
};

export type FeatureSurfaceApi = {
  domain: string;
  method: string;
  path: string;
  operationId: string;
  summary: string;
};

export type FeatureSurfaceImplementationApi = {
  label: string;
  domain: string;
  method: string;
  path: string;
  sourceFiles: string[];
};

export type FeatureSurfaceMetadataGroup = {
  id: string;
  name: string;
  description?: string;
};

export type FeatureSurfaceMetadataItem = {
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

export type FeatureSurfaceMetadata = {
  schemaVersion: number;
  capabilityGroups: FeatureSurfaceMetadataGroup[];
  features: FeatureSurfaceMetadataItem[];
};

export type FeatureSurfaceIndex = {
  generatedAt: string;
  pages: FeatureSurfacePage[];
  apis: FeatureSurfaceApi[];
  contractApis: FeatureSurfaceApi[];
  nextjsApis: FeatureSurfaceImplementationApi[];
  rustApis: FeatureSurfaceImplementationApi[];
  implementationApis: FeatureSurfaceImplementationApi[];
  metadata: FeatureSurfaceMetadata | null;
};

export type FeatureSurfaceIndexResponse = FeatureSurfaceIndex & {
  repoRoot: string;
  warnings: string[];
};

const FEATURE_TREE_PATH = path.join("docs", "product-specs", "FEATURE_TREE.md");
const FEATURE_TREE_INDEX_PATH = path.join("docs", "product-specs", "feature-tree.index.json");

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractFrontmatter(raw: string): string | null {
  const trimmed = raw.replace(/^\uFEFF/, "");
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match?.[1] ?? null;
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

function parseSourceFilesCell(value: string): string[] {
  const codeMatches = [...value.matchAll(/`([^`]+)`/g)]
    .map((match) => normalizeString(match[1]))
    .filter(Boolean);
  if (codeMatches.length > 0) {
    return [...new Set(codeMatches)];
  }

  return value
    .split(",")
    .map((part) => stripCodeCell(part))
    .filter(Boolean);
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

function toPage(value: unknown): FeatureSurfacePage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const route = normalizeString((value as { route?: unknown }).route);
  const title = normalizeString((value as { title?: unknown }).title);
  if (!route || !title) {
    return null;
  }

  return {
    route,
    title,
    description: normalizeString((value as { description?: unknown }).description),
    sourceFile: normalizeString((value as { sourceFile?: unknown }).sourceFile),
  };
}

function toApi(value: unknown): FeatureSurfaceApi | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const domain = normalizeString((value as { domain?: unknown }).domain);
  const method = normalizeString((value as { method?: unknown }).method);
  const endpointPath = normalizeString((value as { path?: unknown }).path);
  if (!domain || !method || !endpointPath) {
    return null;
  }

  return {
    domain,
    method,
    path: endpointPath,
    operationId: normalizeString((value as { operationId?: unknown }).operationId),
    summary: normalizeString((value as { summary?: unknown }).summary),
  };
}

function toImplementationApi(value: unknown): FeatureSurfaceImplementationApi | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const domain = normalizeString((value as { domain?: unknown }).domain);
  const method = normalizeString((value as { method?: unknown }).method);
  const endpointPath = normalizeString((value as { path?: unknown }).path);
  if (!domain || !method || !endpointPath) {
    return null;
  }

  return {
    label: normalizeImplementationLabel(
      normalizeString((value as { label?: unknown }).label) || "implementation",
    ),
    domain,
    method,
    path: endpointPath,
    sourceFiles: toStringArray((value as { sourceFiles?: unknown }).sourceFiles),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function toMetadataGroup(value: unknown): FeatureSurfaceMetadataGroup | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = normalizeString((value as { id?: unknown }).id);
  const name = normalizeString((value as { name?: unknown }).name);
  if (!id || !name) {
    return null;
  }

  const description = normalizeString((value as { description?: unknown }).description);
  return {
    id,
    name,
    ...(description ? { description } : {}),
  };
}

function toMetadataItem(value: unknown): FeatureSurfaceMetadataItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = normalizeString((value as { id?: unknown }).id);
  const name = normalizeString((value as { name?: unknown }).name);
  if (!id || !name) {
    return null;
  }

  const group = normalizeString((value as { group?: unknown }).group);
  const summary = normalizeString((value as { summary?: unknown }).summary);
  const status = normalizeString((value as { status?: unknown }).status);
  const pages = toStringArray((value as { pages?: unknown }).pages);
  const apis = toStringArray((value as { apis?: unknown }).apis);
  const domainObjects = toStringArray(
    (value as { domainObjects?: unknown; domain_objects?: unknown }).domainObjects
      ?? (value as { domainObjects?: unknown; domain_objects?: unknown }).domain_objects,
  );
  const relatedFeatures = toStringArray(
    (value as { relatedFeatures?: unknown; related_features?: unknown }).relatedFeatures
      ?? (value as { relatedFeatures?: unknown; related_features?: unknown }).related_features,
  );
  const sourceFiles = toStringArray(
    (value as { sourceFiles?: unknown; source_files?: unknown }).sourceFiles
      ?? (value as { sourceFiles?: unknown; source_files?: unknown }).source_files,
  );
  const screenshots = toStringArray((value as { screenshots?: unknown }).screenshots);

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
}

function toMetadata(value: unknown): FeatureSurfaceMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const schemaVersion = Number(
    (value as { schemaVersion?: unknown; schema_version?: unknown }).schemaVersion
      ?? (value as { schemaVersion?: unknown; schema_version?: unknown }).schema_version,
  );
  const rawCapabilityGroups = (value as { capabilityGroups?: unknown; capability_groups?: unknown }).capabilityGroups
    ?? (value as { capabilityGroups?: unknown; capability_groups?: unknown }).capability_groups;
  const capabilityGroups = Array.isArray(rawCapabilityGroups)
    ? rawCapabilityGroups.map(toMetadataGroup).filter((item): item is FeatureSurfaceMetadataGroup => Boolean(item))
    : [];
  const rawFeatures = (value as { features?: unknown }).features;
  const features = Array.isArray(rawFeatures)
    ? rawFeatures.map(toMetadataItem).filter((item): item is FeatureSurfaceMetadataItem => Boolean(item))
    : [];

  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1,
    capabilityGroups,
    features,
  };
}

function parseFeatureTreeMarkdown(raw: string): FeatureSurfaceIndex {
  const pages: FeatureSurfacePage[] = [];
  const contractApis: FeatureSurfaceApi[] = [];
  const nextjsApis: FeatureSurfaceImplementationApi[] = [];
  const rustApis: FeatureSurfaceImplementationApi[] = [];
  const implementationApis: FeatureSurfaceImplementationApi[] = [];

  const frontmatter = extractFrontmatter(raw);
  let metadata: FeatureSurfaceMetadata | null = null;
  if (frontmatter) {
    try {
      const parsed = yaml.load(frontmatter) as { feature_metadata?: unknown } | null;
      metadata = toMetadata(parsed?.feature_metadata ?? null);
    } catch {
      metadata = null;
    }
  }

  let section: "pages" | "contract" | "implementation" | null = null;
  let inTable = false;
  let currentGroup = "";
  let currentImplementationLabel = "";

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (trimmed === "## Frontend Pages") {
      section = "pages";
      inTable = false;
      currentGroup = "";
      continue;
    }

    if (trimmed === "## API Contract Endpoints" || trimmed === "## API Endpoints") {
      section = "contract";
      inTable = false;
      currentGroup = "";
      continue;
    }

    if (trimmed === "## Next.js API Routes" || trimmed === "## Next.js-only API Routes") {
      section = "implementation";
      inTable = false;
      currentGroup = "";
      currentImplementationLabel = "nextjs";
      continue;
    }

    if (trimmed === "## Rust API Routes" || trimmed === "## Rust-only API Routes") {
      section = "implementation";
      inTable = false;
      currentGroup = "";
      currentImplementationLabel = "rust";
      continue;
    }

    const implementationLabel = implementationSectionLabelFromHeading(trimmed);
    if (implementationLabel) {
      section = "implementation";
      inTable = false;
      currentGroup = "";
      currentImplementationLabel = implementationLabel;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      section = null;
      inTable = false;
      currentGroup = "";
      currentImplementationLabel = "";
      continue;
    }

    if (!section) {
      continue;
    }

    if (trimmed.startsWith("### ")) {
      currentGroup = normalizeDomainHeading(
        trimmed.replace(/^###\s+/, "").replace(/\s+\(\d+\)\s*$/, "").trim(),
      );
      inTable = false;
      continue;
    }

    if (section === "pages") {
      if (trimmed === "| Page | Route | Source File | Description |" || trimmed === "| Page | Route | Description |") {
        inTable = true;
        continue;
      }
      if (!trimmed) {
        inTable = false;
        continue;
      }
      if (!inTable || trimmed === "|------|-------|-------------|-------------|" || trimmed === "|------|-------|-------------|") {
        continue;
      }

      const cells = parseMarkdownRow(trimmed);
      if (cells && cells.length >= 3) {
        pages.push({
          route: stripCodeCell(cells[1] ?? ""),
          title: normalizeString(cells[0]),
          sourceFile: cells.length >= 4 ? stripCodeCell(cells[2] ?? "") : "",
          description: normalizeString(cells.length >= 4 ? cells[3] : cells[2]),
        });
      }
      continue;
    }

    if (
      trimmed === "| Method | Endpoint | Details |"
      || trimmed === "| Method | Endpoint | Description |"
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
    if (
      !inTable
      || trimmed === "|--------|----------|---------|"
      || trimmed === "|--------|----------|-------------|"
      || trimmed === "|--------|----------|---------|---------|------|"
      || trimmed === "|--------|----------|--------------|"
    ) {
      continue;
    }

    const cells = parseMarkdownRow(trimmed);
    if (!cells || cells.length < 3) {
      continue;
    }

    const method = normalizeString(cells[0]);
    const endpointPath = stripCodeCell(cells[1] ?? "");
    const details = normalizeString(cells[2]);
    if (!method || !endpointPath) {
      continue;
    }

    if (section === "contract") {
      contractApis.push({
        domain: currentGroup,
        method,
        path: endpointPath,
        operationId: "",
        summary: details,
      });
      if (cells.length >= 5) {
        const nextjsSourceFiles = parseSourceFilesCell(cells[3] ?? "");
        if (nextjsSourceFiles.length > 0) {
          const nextjsApi: FeatureSurfaceImplementationApi = {
            label: "nextjs",
            domain: currentGroup,
            method,
            path: endpointPath,
            sourceFiles: nextjsSourceFiles,
          };
          nextjsApis.push(nextjsApi);
          implementationApis.push(nextjsApi);
        }

        const rustSourceFiles = parseSourceFilesCell(cells[4] ?? "");
        if (rustSourceFiles.length > 0) {
          const rustApi: FeatureSurfaceImplementationApi = {
            label: "rust",
            domain: currentGroup,
            method,
            path: endpointPath,
            sourceFiles: rustSourceFiles,
          };
          rustApis.push(rustApi);
          implementationApis.push(rustApi);
        }
      }
      continue;
    }

    const parsedImplementationApi: FeatureSurfaceImplementationApi = {
      label: currentImplementationLabel,
      domain: currentGroup,
      method,
      path: endpointPath,
      sourceFiles: parseSourceFilesCell(cells[2] ?? ""),
    };

    implementationApis.push(parsedImplementationApi);
    if (currentImplementationLabel === "nextjs") {
      nextjsApis.push(parsedImplementationApi);
    } else if (currentImplementationLabel === "rust") {
      rustApis.push(parsedImplementationApi);
    }
  }

  return {
    generatedAt: "",
    pages,
    apis: contractApis,
    contractApis,
    nextjsApis,
    rustApis,
    implementationApis,
    metadata: normalizeSurfaceMetadata({
      metadata,
      pages,
      contractApis,
      nextjsApis,
      rustApis,
      implementationApis,
    }),
  };
}

function emptyResponse(repoRoot: string, warnings: string[] = []): FeatureSurfaceIndexResponse {
  return {
    generatedAt: "",
    pages: [],
    apis: [],
    contractApis: [],
    nextjsApis: [],
    rustApis: [],
    implementationApis: [],
    metadata: null,
    repoRoot,
    warnings,
  };
}

export async function readFeatureSurfaceIndex(repoRoot: string): Promise<FeatureSurfaceIndexResponse> {
  const featureTreePath = path.join(repoRoot, FEATURE_TREE_PATH);
  try {
    const raw = await fsp.readFile(featureTreePath, "utf-8");
    return {
      ...parseFeatureTreeMarkdown(raw),
      repoRoot,
      warnings: [],
    };
  } catch {
    // Fall back to the machine-readable cache when the markdown source is absent.
  }

  const indexPath = path.join(repoRoot, FEATURE_TREE_INDEX_PATH);
  let raw: string;
  try {
    raw = await fsp.readFile(indexPath, "utf-8");
  } catch {
    return emptyResponse(repoRoot, [`Feature surface index not found at ${path.relative(repoRoot, featureTreePath)}`]);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return emptyResponse(repoRoot, [`Feature surface index is not valid JSON at ${path.relative(repoRoot, indexPath)}`]);
  }

  const pages = Array.isArray((payload as { pages?: unknown }).pages)
    ? ((payload as { pages: unknown[] }).pages.map(toPage).filter((item): item is FeatureSurfacePage => Boolean(item)))
    : [];
  const apis = Array.isArray((payload as { apis?: unknown }).apis)
    ? ((payload as { apis: unknown[] }).apis.map(toApi).filter((item): item is FeatureSurfaceApi => Boolean(item)))
    : [];
  const contractApis = Array.isArray((payload as { contractApis?: unknown }).contractApis)
    ? ((payload as { contractApis: unknown[] }).contractApis.map(toApi).filter((item): item is FeatureSurfaceApi => Boolean(item)))
    : apis;
  const nextjsApis = Array.isArray((payload as { nextjsApis?: unknown }).nextjsApis)
    ? ((payload as { nextjsApis: unknown[] }).nextjsApis
      .map(toImplementationApi)
      .map((item) => (item ? { ...item, label: "nextjs" } : null))
      .filter((item): item is FeatureSurfaceImplementationApi => Boolean(item)))
    : [];
  const rustApis = Array.isArray((payload as { rustApis?: unknown }).rustApis)
    ? ((payload as { rustApis: unknown[] }).rustApis
      .map(toImplementationApi)
      .map((item) => (item ? { ...item, label: "rust" } : null))
      .filter((item): item is FeatureSurfaceImplementationApi => Boolean(item)))
    : [];
  const implementationApisFromPayload = Array.isArray((payload as { implementationApis?: unknown }).implementationApis)
    ? ((payload as { implementationApis: unknown[] }).implementationApis
      .map(toImplementationApi)
      .filter((item): item is FeatureSurfaceImplementationApi => Boolean(item)))
    : [];
  const implementationApis = implementationApisFromPayload.length > 0
    ? implementationApisFromPayload
    : [...nextjsApis, ...rustApis];

  const normalizedMetadata = normalizeSurfaceMetadata({
    metadata: toMetadata((payload as { metadata?: unknown }).metadata),
    pages,
    contractApis,
    nextjsApis,
    rustApis,
    implementationApis,
  });

  return {
    generatedAt: normalizeString((payload as { generatedAt?: unknown }).generatedAt),
    pages,
    apis,
    contractApis,
    nextjsApis,
    rustApis,
    implementationApis,
    metadata: normalizedMetadata,
    repoRoot,
    warnings: [],
  };
}
