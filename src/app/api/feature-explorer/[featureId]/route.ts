import { NextRequest, NextResponse } from "next/server";

import featureSurfaceMetadata from "@/core/spec/feature-surface-metadata";

import {
  ApiEndpointDetail,
  FrontendPageDetail,
  FeatureTree,
  buildFileTree,
  collectFeatureSessionStats,
  isContextError,
  parseContext,
  parseFeatureSurfaceCatalog,
  parseFeatureSurfaceLinks,
  parseFeatureTree,
  resolveRepoRoot,
  splitDeclaredApi,
} from "../shared";

const { buildApiLookupKey } = featureSurfaceMetadata;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeatureDetailResponse {
  id: string;
  name: string;
  group: string;
  summary: string;
  status: string;
  pages: string[];
  apis: string[];
  sourceFiles: string[];
  relatedFiles: string[];
  relatedFeatures: string[];
  domainObjects: string[];
  sessionCount: number;
  changedFiles: number;
  updatedAt: string;
  fileTree: ReturnType<typeof buildFileTree>;
  surfaceLinks: { kind: string; route: string; sourcePath: string }[];
  pageDetails: FrontendPageDetail[];
  apiDetails: ApiEndpointDetail[];
  fileStats: Record<string, { changes: number; sessions: number; updatedAt: string }>;
  fileSignals: Record<string, {
    sessions: Array<{
      provider: string;
      sessionId: string;
      updatedAt: string;
      promptSnippet: string;
      promptHistory: string[];
      toolNames: string[];
      changedFiles?: string[];
      resumeCommand?: string;
      diagnostics?: {
        toolCallCount: number;
        failedToolCallCount: number;
        toolCallsByName: Record<string, number>;
        readFiles: string[];
        writtenFiles: string[];
        repeatedReadFiles: string[];
        repeatedCommands: string[];
        failedTools: Array<{
          toolName: string;
          command?: string;
          message: string;
        }>;
      };
    }>;
    toolHistory: string[];
    promptHistory: string[];
  }>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function collectFeatureFileScope(
  feature: FeatureTree["features"][number],
  repoRoot: string,
  observedFiles: string[],
): { allFiles: string[]; relatedFiles: string[] } {
  const catalog = parseFeatureSurfaceCatalog(repoRoot);
  const declaredSourceFiles = [...new Set(feature.sourceFiles)].sort();
  const declaredSourceFileSet = new Set(declaredSourceFiles);
  const files = new Set<string>([...declaredSourceFiles, ...observedFiles]);

  for (const sourceFile of files) {
    const links = parseFeatureSurfaceLinks(catalog, sourceFile);
    for (const link of links) {
      files.add(link.sourcePath);
    }
  }

  const allFiles = [...files].sort();
  const relatedFiles = allFiles.filter((filePath) => !declaredSourceFileSet.has(filePath));

  return {
    allFiles,
    relatedFiles,
  };
}

function collectSurfaceLinks(
  feature: FeatureTree["features"][number],
  repoRoot: string,
): { kind: string; route: string; sourcePath: string }[] {
  const catalog = parseFeatureSurfaceCatalog(repoRoot);
  const lookup = new Map<string, { kind: string; route: string; sourcePath: string }>();

  for (const sourceFile of feature.sourceFiles) {
    for (const link of parseFeatureSurfaceLinks(catalog, sourceFile)) {
      const key = `${link.kind}|${link.route}|${link.sourcePath}`;
      lookup.set(key, {
        kind: link.kind,
        route: link.route,
        sourcePath: link.sourcePath,
      });
    }
  }

  return [...lookup.values()];
}

function toPageDetails(feature: FeatureTree["features"][number], featureTree: FeatureTree): FrontendPageDetail[] {
  return feature.pages.map((route) => {
    const matched = featureTree.frontendPages.find((page) => page.route === route);
    return matched ?? {
      name: route,
      route,
      description: "",
      sourceFile: "",
    };
  });
}

function toApiDetails(feature: FeatureTree["features"][number], featureTree: FeatureTree): ApiEndpointDetail[] {
  return feature.apis.map((declaration) => {
    const parsed = splitDeclaredApi(declaration);
    const lookupKey = buildApiLookupKey(parsed.method, parsed.endpoint);
    const implementationSources = featureTree.implementationApiEndpoints
      .filter((api) => buildApiLookupKey(api.method, api.endpoint) === lookupKey)
      .map((api) => ({
        label: api.label,
        sourceFiles: api.sourceFiles,
      }));
    const nextjsSourceFiles = featureTree.nextjsApiEndpoints
      .filter((api) => buildApiLookupKey(api.method, api.endpoint) === lookupKey)
      .flatMap((api) => api.sourceFiles);
    const rustSourceFiles = featureTree.rustApiEndpoints
      .filter((api) => buildApiLookupKey(api.method, api.endpoint) === lookupKey)
      .flatMap((api) => api.sourceFiles);
    const matched = featureTree.apiEndpoints.find(
      (api) => buildApiLookupKey(api.method, api.endpoint) === lookupKey,
    );

    return matched ? {
      ...matched,
      nextjsSourceFiles,
      rustSourceFiles,
      ...(implementationSources.length > 0 ? { implementationSources } : {}),
    } : {
      group: "",
      method: parsed.method,
      endpoint: parsed.endpoint,
      description: "",
      nextjsSourceFiles,
      rustSourceFiles,
      ...(implementationSources.length > 0 ? { implementationSources } : {}),
    };
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const featureTree = parseFeatureTree(repoRoot);
    const feature = featureTree.features.find((item) => item.id === featureId);

    if (!feature) {
      return NextResponse.json(
        {
          error: "Feature not found",
          featureId,
        },
        { status: 404 },
      );
    }

    const {
      featureStats,
      fileStats: rawFileStats,
      fileSignals: rawFileSignals,
    } = collectFeatureSessionStats(repoRoot, featureTree);

    const featureStat = featureStats[feature.id] ?? {
      sessionCount: 0,
      changedFiles: feature.sourceFiles.length,
      updatedAt: "",
      matchedFiles: [],
    };
    const { allFiles, relatedFiles } = collectFeatureFileScope(feature, repoRoot, featureStat.matchedFiles);

    const response: FeatureDetailResponse = {
      id: feature.id,
      name: feature.name,
      group: feature.group,
      summary: feature.summary,
      status: feature.status,
      pages: feature.pages,
      apis: feature.apis,
      sourceFiles: [...new Set(feature.sourceFiles)].sort(),
      relatedFiles,
      relatedFeatures: feature.relatedFeatures,
      domainObjects: feature.domainObjects,
      sessionCount: featureStat.sessionCount,
      changedFiles: featureStat.changedFiles,
      updatedAt: featureStat.updatedAt !== "" ? featureStat.updatedAt : "-",
      fileTree: buildFileTree(allFiles),
      surfaceLinks: collectSurfaceLinks(feature, repoRoot),
      pageDetails: toPageDetails(feature, featureTree),
      apiDetails: toApiDetails(feature, featureTree),
      fileStats: {},
      fileSignals: {},
    };

    for (const filePath of allFiles) {
      const stat = rawFileStats[filePath];
      if (!stat) {
        const signal = rawFileSignals[filePath];
        if (signal) {
          response.fileSignals[filePath] = signal;
        }
        continue;
      }

      response.fileStats[filePath] = {
        changes: stat.changes,
        sessions: stat.sessions,
        updatedAt: stat.updatedAt,
      };

      const signal = rawFileSignals[filePath];
      if (signal) {
        response.fileSignals[filePath] = signal;
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        { error: "Feature explorer context error", details: message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Feature explorer failed", details: message },
      { status: 500 },
    );
  }
}
