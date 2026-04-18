"use client";

export const STATUS_COLUMNS = ["open", "investigating", "resolved", "wontfix"] as const;

export type SpecStatus = typeof STATUS_COLUMNS[number];

export type SpecIssue = {
  filename: string;
  title: string;
  date: string;
  kind: string;
  status: string;
  severity: string;
  area: string;
  tags: string[];
  reportedBy: string;
  relatedIssues: string[];
  githubIssue: number | null;
  githubState: string | null;
  githubUrl: string | null;
  body: string;
};

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

export type FeatureSurfaceIndexResponse = {
  generatedAt: string;
  pages: FeatureSurfacePage[];
  apis: FeatureSurfaceApi[];
  metadata: FeatureSurfaceMetadata | null;
  repoRoot: string;
  warnings: string[];
};

export type ResolvedRelation = {
  raw: string;
  key: string;
  label: string;
  kind: "local" | "github" | "external";
  href: string | null;
  targetFilename: string | null;
};

export type SurfaceHit = {
  key: string;
  kind: "page" | "api";
  label: string;
  secondaryLabel: string;
  description: string;
  confidence: "high" | "medium" | "low";
  score: number;
  evidence: string[];
  explicit: boolean;
};

export type IssueRelations = {
  outgoing: ResolvedRelation[];
  incoming: SpecIssue[];
  localOutgoing: SpecIssue[];
  familyId: string;
  familyIssues: SpecIssue[];
};

export type IssueFamily = {
  id: string;
  label: string;
  issues: SpecIssue[];
  unresolvedCount: number;
  relationCount: number;
  surfaces: SurfaceHit[];
  dominantAreas: string[];
};

export type SpecBoardModel = {
  issueByFilename: Map<string, SpecIssue>;
  relationsByFilename: Map<string, IssueRelations>;
  surfaceHitsByFilename: Map<string, SurfaceHit[]>;
  families: IssueFamily[];
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const STATUS_RANK: Record<SpecStatus, number> = {
  open: 0,
  investigating: 1,
  resolved: 2,
  wontfix: 3,
};

const TOKEN_STOPWORDS = new Set([
  "api",
  "app",
  "board",
  "bug",
  "card",
  "docs",
  "file",
  "files",
  "flow",
  "issue",
  "issues",
  "page",
  "record",
  "spec",
  "task",
  "tasks",
  "test",
  "tests",
  "ui",
  "user",
  "view",
  "workspace",
]);

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function compareDatesDesc(a: string, b: string): number {
  const aTime = Date.parse(a || "");
  const bTime = Date.parse(b || "");
  const normalizedA = Number.isNaN(aTime) ? 0 : aTime;
  const normalizedB = Number.isNaN(bTime) ? 0 : bTime;
  return normalizedB - normalizedA;
}

function sortIssues(a: SpecIssue, b: SpecIssue): number {
  const statusDiff = STATUS_RANK[normalizeSpecStatus(a.status)] - STATUS_RANK[normalizeSpecStatus(b.status)];
  if (statusDiff !== 0) {
    return statusDiff;
  }

  const severityDiff = (SEVERITY_RANK[normalizeText(a.severity)] ?? 99) - (SEVERITY_RANK[normalizeText(b.severity)] ?? 99);
  if (severityDiff !== 0) {
    return severityDiff;
  }

  const dateDiff = compareDatesDesc(a.date, b.date);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  return (a.title || a.filename).localeCompare(b.title || b.filename);
}

function makeDynamicPathMatcher(pattern: string): RegExp | null {
  if (!pattern) {
    return null;
  }

  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z0-9_]+)/g, "[^/]+")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");

  try {
    return new RegExp(`(^|[^A-Za-z0-9_])(${escaped})(?=$|[^A-Za-z0-9_])`, "iu");
  } catch {
    return null;
  }
}

function extractMatches(pattern: RegExp, text: string): string[] {
  const matches: string[] = [];
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

  let next = regex.exec(text);
  while (next) {
    const value = (next[1] || next[2] || next[0] || "").trim();
    if (value) {
      matches.push(value);
    }
    next = regex.exec(text);
  }

  return matches;
}

function normalizeRepoPath(value: string): string {
  return value.trim().replace(/^\.?\//u, "").replace(/[),.:;]+$/u, "");
}

function extractPathMentions(text: string): Set<string> {
  const paths = new Set<string>();

  const codeSpanPattern = /`([^`\n]+)`/g;
  for (const match of extractMatches(codeSpanPattern, text)) {
    const normalized = normalizeRepoPath(match);
    if (normalized.includes("/") && /\.(md|json|yaml|yml|ts|tsx|js|jsx|rs)$/u.test(normalized)) {
      paths.add(normalized);
    }
  }

  const plainPathPattern = /\b(?:src|docs|crates|apps|resources)\/[^\s`),]+/g;
  for (const match of extractMatches(plainPathPattern, text)) {
    const normalized = normalizeRepoPath(match);
    if (normalized.includes("/")) {
      paths.add(normalized);
    }
  }

  return paths;
}

function extractRouteMentions(text: string): Set<string> {
  const routes = new Set<string>();
  const routePattern = /\/(?:workspace|settings|messages|traces|debug|mcp-tools|a2a|ag-ui)[^\s`),]*/g;

  for (const match of extractMatches(routePattern, text)) {
    routes.add(match.replace(/[),.:;]+$/u, ""));
  }

  return routes;
}

function extractApiMentions(text: string): Set<string> {
  const apis = new Set<string>();
  const apiPattern = /\/api\/[^\s`),]+/g;

  for (const match of extractMatches(apiPattern, text)) {
    apis.add(match.replace(/[),.:;]+$/u, ""));
  }

  return apis;
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9-]+/u)
    .filter((token) => token.length >= 4 || token.includes("-"))
    .filter((token) => !TOKEN_STOPWORDS.has(token));
}

function collectSemanticTokens(issue: SpecIssue): Set<string> {
  return new Set<string>([
    ...tokenize(issue.area),
    ...issue.tags.flatMap((tag) => tokenize(tag)),
  ]);
}

function scoreToConfidence(score: number): SurfaceHit["confidence"] {
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function areaAnchorsSurface(area: string, ...fields: string[]): boolean {
  const normalizedArea = normalizeText(area);
  if (!normalizedArea) {
    return false;
  }

  return fields.some((field) => normalizeText(field).includes(normalizedArea));
}

function formatFilenameLabel(value: string): string {
  return value.replace(/^docs\/issues\//u, "").replace(/\.md$/u, "");
}

function normalizeDocsIssueFilename(value: string): string | null {
  const normalized = normalizeRepoPath(value);
  if (!normalized || /^https?:\/\//u.test(normalized)) {
    return null;
  }

  if (normalized.includes("docs/issues/")) {
    const parts = normalized.split("/");
    return parts[parts.length - 1] ?? null;
  }

  if (normalized.endsWith(".md")) {
    const parts = normalized.split("/");
    return parts[parts.length - 1] ?? null;
  }

  return null;
}

function normalizeGitHubIssueUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/u);
    if (!match) {
      return null;
    }
    return `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`;
  } catch {
    return null;
  }
}

function formatGitHubIssueLabel(value: string): string {
  const normalizedUrl = normalizeGitHubIssueUrl(value);
  if (!normalizedUrl) {
    return value;
  }

  const match = normalizedUrl.match(/\/issues\/(\d+)$/u);
  return match ? `#${match[1]}` : normalizedUrl;
}

function formatExternalLabel(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/u, "");
  } catch {
    return value;
  }
}

export function normalizeSpecStatus(value: string): SpecStatus {
  const normalized = normalizeText(value);
  if (normalized === "closed") return "resolved";
  return STATUS_COLUMNS.includes(normalized as SpecStatus) ? normalized as SpecStatus : "open";
}

function resolveIssueRelation(
  rawValue: string,
  issueByFilename: Map<string, SpecIssue>,
  issueByGitHubUrl: Map<string, SpecIssue>,
): ResolvedRelation | null {
  const raw = rawValue.trim();
  if (!raw) {
    return null;
  }

  const localFilename = normalizeDocsIssueFilename(raw);
  if (localFilename) {
    const targetIssue = issueByFilename.get(localFilename);
    return {
      raw,
      key: targetIssue ? `local:${targetIssue.filename}` : `local:${localFilename}`,
      label: targetIssue?.title || formatFilenameLabel(localFilename),
      kind: "local",
      href: null,
      targetFilename: targetIssue?.filename ?? null,
    };
  }

  const githubUrl = normalizeGitHubIssueUrl(raw);
  if (githubUrl) {
    const targetIssue = issueByGitHubUrl.get(githubUrl);
    return {
      raw,
      key: targetIssue ? `local:${targetIssue.filename}` : `github:${githubUrl}`,
      label: targetIssue?.title || formatGitHubIssueLabel(githubUrl),
      kind: "github",
      href: githubUrl,
      targetFilename: targetIssue?.filename ?? null,
    };
  }

  return {
    raw,
    key: `external:${raw}`,
    label: formatExternalLabel(raw),
    kind: "external",
    href: (() => {
      try {
        return new URL(raw).toString();
      } catch {
        return null;
      }
    })(),
    targetFilename: null,
  };
}

function dedupeRelations(relations: ResolvedRelation[]): ResolvedRelation[] {
  const seen = new Set<string>();
  const deduped: ResolvedRelation[] = [];

  for (const relation of relations) {
    if (seen.has(relation.key)) {
      continue;
    }
    seen.add(relation.key);
    deduped.push(relation);
  }

  return deduped;
}

function dedupeIncomingIssues(issues: SpecIssue[]): SpecIssue[] {
  const seen = new Set<string>();
  const deduped: SpecIssue[] = [];

  for (const issue of issues) {
    if (seen.has(issue.filename)) {
      continue;
    }
    seen.add(issue.filename);
    deduped.push(issue);
  }

  return deduped.sort(sortIssues);
}

function endpointBasePath(path: string): string {
  return path.replace(/\/\{[^}]+\}/gu, "");
}

function apiPathToRouteFile(path: string): string {
  return `src/app${path.replace(/\{([^}]+)\}/gu, "[$1]")}/route.ts`;
}

function normalizeDynamicPathKey(value: string): string {
  return value
    .replace(/\[([^\]]+)\]/gu, "[]")
    .replace(/\{([^}]+)\}/gu, "[]");
}

function isGenericSurface(hit: SurfaceHit): boolean {
  if (hit.kind !== "page") {
    return false;
  }

  return (
    hit.secondaryLabel === "/" ||
    hit.secondaryLabel === "/workspace/:workspaceId" ||
    normalizeText(hit.label).includes("wrapper")
  );
}

function buildPageHit(issue: SpecIssue, page: FeatureSurfacePage): SurfaceHit | null {
  const evidence = new Set<string>();
  let score = 0;
  let explicit = false;

  const text = `${issue.title}\n${issue.body}`;
  const routeMentions = extractRouteMentions(text);
  const pathMentions = extractPathMentions(text);
  const semanticTokens = collectSemanticTokens(issue);

  if (page.sourceFile && pathMentions.has(page.sourceFile)) {
    score += 8;
    evidence.add(page.sourceFile);
    explicit = true;
  }

  if (page.route !== "/") {
    const routeMatcher = makeDynamicPathMatcher(page.route);
    if (routeMatcher && routeMatcher.test(text)) {
      score += 7;
      evidence.add(page.route);
      explicit = true;
    } else {
      for (const routeMention of routeMentions) {
        if (routeMatcher?.test(routeMention)) {
          score += 7;
          evidence.add(routeMention);
          explicit = true;
          break;
        }
      }
    }
  }

  const pageTokens = new Set<string>([
    ...tokenize(page.route),
    ...tokenize(page.title),
    ...tokenize(page.description),
    ...tokenize(page.sourceFile),
  ]);
  const overlap = [...semanticTokens].filter((token) => pageTokens.has(token));
  if (overlap.length > 0) {
    score += Math.min(4, overlap.length * 2);
    overlap.slice(0, 2).forEach((token) => evidence.add(token));
  }

  const anchoredByArea = areaAnchorsSurface(issue.area, page.route, page.title, page.sourceFile);
  const allowedSemanticFallback = overlap.length >= 2 && anchoredByArea && page.route !== "/";

  if ((!explicit && !allowedSemanticFallback) || score < 3) {
    return null;
  }

  return {
    key: `page:${page.route}`,
    kind: "page",
    label: page.title || page.route,
    secondaryLabel: page.route,
    description: page.description,
    confidence: scoreToConfidence(score),
    score,
    evidence: [...evidence].slice(0, 3),
    explicit,
  };
}

function buildApiHit(issue: SpecIssue, api: FeatureSurfaceApi): SurfaceHit | null {
  const evidence = new Set<string>();
  let score = 0;
  let explicit = false;

  const text = `${issue.title}\n${issue.body}`;
  const apiMentions = extractApiMentions(text);
  const pathMentions = extractPathMentions(text);
  const semanticTokens = collectSemanticTokens(issue);

  const apiMatcher = makeDynamicPathMatcher(api.path);
  const apiBasePath = endpointBasePath(api.path);
  for (const apiMention of apiMentions) {
    if (
      apiMatcher?.test(apiMention) ||
      apiMention === api.path ||
      (apiBasePath && apiMention.startsWith(apiBasePath))
    ) {
      score += 8;
      evidence.add(apiMention);
      explicit = true;
      break;
    }
  }

  const routeFile = apiPathToRouteFile(api.path);
  const normalizedRouteFile = normalizeDynamicPathKey(routeFile);
  if ([...pathMentions].some((mention) => normalizeDynamicPathKey(mention) === normalizedRouteFile)) {
    score += 6;
    evidence.add(routeFile);
    explicit = true;
  }

  const apiTokens = new Set<string>([
    ...tokenize(api.domain),
    ...tokenize(api.path),
    ...tokenize(api.operationId),
    ...tokenize(api.summary),
  ]);
  const overlap = [...semanticTokens].filter((token) => apiTokens.has(token));
  if (overlap.length > 0) {
    score += Math.min(4, overlap.length * 2);
    overlap.slice(0, 2).forEach((token) => evidence.add(token));
  }

  const anchoredByArea = areaAnchorsSurface(issue.area, api.domain, api.path, api.summary);
  const allowedSemanticFallback = overlap.length >= 2 && anchoredByArea;

  if ((!explicit && !allowedSemanticFallback) || score < 3) {
    return null;
  }

  return {
    key: `api:${api.method}:${api.path}`,
    kind: "api",
    label: api.summary || api.path,
    secondaryLabel: `${api.method} ${api.path}`,
    description: api.domain,
    confidence: scoreToConfidence(score),
    score,
    evidence: [...evidence].slice(0, 3),
    explicit,
  };
}

function sortSurfaceHits(a: SurfaceHit, b: SurfaceHit): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.kind !== b.kind) {
    return a.kind === "page" ? -1 : 1;
  }
  return a.secondaryLabel.localeCompare(b.secondaryLabel);
}

function aggregateFamilyHits(hits: SurfaceHit[]): SurfaceHit[] {
  const grouped = new Map<string, SurfaceHit>();

  for (const hit of hits) {
    const existing = grouped.get(hit.key);
    if (!existing) {
      grouped.set(hit.key, {
        ...hit,
        evidence: [...hit.evidence],
      });
      continue;
    }

    existing.score += hit.score;
    existing.evidence = [...new Set([...existing.evidence, ...hit.evidence])].slice(0, 3);
    existing.explicit = existing.explicit || hit.explicit;
    if (hit.confidence === "high" || (hit.confidence === "medium" && existing.confidence === "low")) {
      existing.confidence = hit.confidence;
    }
  }

  return [...grouped.values()].sort(sortSurfaceHits);
}

function countUnresolved(issues: SpecIssue[]): number {
  return issues.filter((issue) => {
    const status = normalizeSpecStatus(issue.status);
    return status === "open" || status === "investigating";
  }).length;
}

function computeDominantAreas(issues: SpecIssue[]): string[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const area = issue.area.trim();
    if (!area) {
      continue;
    }
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([area]) => area)
    .slice(0, 3);
}

function buildFamilyLabel(issues: SpecIssue[], surfaces: SurfaceHit[]): string {
  const dominantArea = computeDominantAreas(issues)[0];
  if (dominantArea) {
    return dominantArea;
  }

  const topExplicitSurface = surfaces.find(
    (surface) => !isGenericSurface(surface) && (surface.explicit || surface.confidence !== "low"),
  );
  if (topExplicitSurface) {
    return topExplicitSurface.label;
  }

  return issues[0]?.title || issues[0]?.filename || "Issue family";
}

export function buildSpecBoardModel(
  issues: SpecIssue[],
  surfaceIndex: FeatureSurfaceIndexResponse,
): SpecBoardModel {
  const sortedIssues = [...issues].sort(sortIssues);
  const issueByFilename = new Map(sortedIssues.map((issue) => [issue.filename, issue]));
  const issueByGitHubUrl = new Map<string, SpecIssue>();

  for (const issue of sortedIssues) {
    const normalizedUrl = issue.githubUrl ? normalizeGitHubIssueUrl(issue.githubUrl) : null;
    if (normalizedUrl) {
      issueByGitHubUrl.set(normalizedUrl, issue);
    }
  }

  const outgoingMap = new Map<string, ResolvedRelation[]>();
  const incomingMap = new Map<string, SpecIssue[]>();
  const adjacency = new Map<string, Set<string>>();
  const surfaceHitsByFilename = new Map<string, SurfaceHit[]>();

  for (const issue of sortedIssues) {
    adjacency.set(issue.filename, new Set<string>());

    const outgoing = dedupeRelations(
      issue.relatedIssues
        .map((rawRelation) => resolveIssueRelation(rawRelation, issueByFilename, issueByGitHubUrl))
        .filter((relation): relation is ResolvedRelation => Boolean(relation))
        .filter((relation) => relation.targetFilename !== issue.filename),
    );

    outgoingMap.set(issue.filename, outgoing);

    for (const relation of outgoing) {
      if (!relation.targetFilename || relation.targetFilename === issue.filename) {
        continue;
      }

      const existing = incomingMap.get(relation.targetFilename) ?? [];
      existing.push(issue);
      incomingMap.set(relation.targetFilename, existing);

      adjacency.get(issue.filename)?.add(relation.targetFilename);
      const reverse = adjacency.get(relation.targetFilename) ?? new Set<string>();
      reverse.add(issue.filename);
      adjacency.set(relation.targetFilename, reverse);
    }

    const pageHits = surfaceIndex.pages
      .map((page) => buildPageHit(issue, page))
      .filter((hit): hit is SurfaceHit => Boolean(hit));
    const apiHits = surfaceIndex.apis
      .map((api) => buildApiHit(issue, api))
      .filter((hit): hit is SurfaceHit => Boolean(hit));

    surfaceHitsByFilename.set(issue.filename, [...pageHits, ...apiHits].sort(sortSurfaceHits).slice(0, 6));
  }

  const familyIdByFilename = new Map<string, string>();
  const familyMembersById = new Map<string, SpecIssue[]>();
  const visited = new Set<string>();

  for (const issue of sortedIssues) {
    if (visited.has(issue.filename)) {
      continue;
    }

    const queue = [issue.filename];
    const members: SpecIssue[] = [];
    visited.add(issue.filename);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const currentIssue = issueByFilename.get(current);
      if (currentIssue) {
        members.push(currentIssue);
      }

      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) {
          continue;
        }
        visited.add(next);
        queue.push(next);
      }
    }

    const familyIssues = members.sort(sortIssues);
    const familyId = familyIssues[0]?.filename ?? issue.filename;

    familyMembersById.set(familyId, familyIssues);
    familyIssues.forEach((member) => {
      familyIdByFilename.set(member.filename, familyId);
    });
  }

  const relationsByFilename = new Map<string, IssueRelations>();
  for (const issue of sortedIssues) {
    const familyId = familyIdByFilename.get(issue.filename) ?? issue.filename;
    const familyIssues = (familyMembersById.get(familyId) ?? [issue]).filter((member) => member.filename !== issue.filename);

    relationsByFilename.set(issue.filename, {
      outgoing: outgoingMap.get(issue.filename) ?? [],
      incoming: dedupeIncomingIssues(incomingMap.get(issue.filename) ?? []),
      localOutgoing: (outgoingMap.get(issue.filename) ?? [])
        .filter((relation) => Boolean(relation.targetFilename))
        .map((relation) => issueByFilename.get(relation.targetFilename as string))
        .filter((candidate): candidate is SpecIssue => Boolean(candidate))
        .sort(sortIssues),
      familyId,
      familyIssues: familyIssues.sort(sortIssues),
    });
  }

  const families = [...familyMembersById.entries()]
    .map(([id, familyIssues]) => {
      let relationCount = 0;
      for (const familyIssue of familyIssues) {
        relationCount += (outgoingMap.get(familyIssue.filename) ?? [])
          .filter((relation) => relation.targetFilename && familyIdByFilename.get(relation.targetFilename) === id)
          .length;
      }

      const familySurfaces = aggregateFamilyHits(
        familyIssues.flatMap((familyIssue) => surfaceHitsByFilename.get(familyIssue.filename) ?? []),
      );

      return {
        id,
        label: buildFamilyLabel(familyIssues, familySurfaces),
        issues: familyIssues,
        unresolvedCount: countUnresolved(familyIssues),
        relationCount,
        surfaces: familySurfaces.slice(0, 4),
        dominantAreas: computeDominantAreas(familyIssues),
      } satisfies IssueFamily;
    })
    .sort((a, b) => {
      if (b.unresolvedCount !== a.unresolvedCount) {
        return b.unresolvedCount - a.unresolvedCount;
      }
      if (b.relationCount !== a.relationCount) {
        return b.relationCount - a.relationCount;
      }
      if (b.issues.length !== a.issues.length) {
        return b.issues.length - a.issues.length;
      }
      return compareDatesDesc(a.issues[0]?.date ?? "", b.issues[0]?.date ?? "");
    });

  return {
    issueByFilename,
    relationsByFilename,
    surfaceHitsByFilename,
    families,
  };
}
