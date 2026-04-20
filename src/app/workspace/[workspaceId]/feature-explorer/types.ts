export interface CapabilityGroup {
  id: string;
  name: string;
  description: string;
}

export interface FeatureSummary {
  id: string;
  name: string;
  group: string;
  summary: string;
  status: string;
  sessionCount: number;
  changedFiles: number;
  updatedAt: string;
  sourceFileCount: number;
  pageCount: number;
  apiCount: number;
}

export interface FeatureDetail {
  id: string;
  name: string;
  group: string;
  summary: string;
  status: string;
  pages: string[];
  apis: string[];
  sourceFiles: string[];
  relatedFiles?: string[];
  relatedFeatures: string[];
  domainObjects: string[];
  sessionCount: number;
  changedFiles: number;
  updatedAt: string;
  fileTree: FileTreeNode[];
  surfaceLinks?: SurfaceLink[];
  pageDetails?: PageDetail[];
  apiDetails?: ApiDetail[];
  fileStats?: Record<string, FileStat>;
  fileSignals?: Record<string, FileSignal>;
}

export interface FileStat {
  changes: number;
  sessions: number;
  updatedAt: string;
}

export interface FileSessionToolFailure {
  toolName: string;
  command?: string;
  message: string;
}

export interface FileSessionDiagnostics {
  toolCallCount: number;
  failedToolCallCount: number;
  toolCallsByName: Record<string, number>;
  readFiles: string[];
  writtenFiles: string[];
  repeatedReadFiles: string[];
  repeatedCommands: string[];
  failedTools: FileSessionToolFailure[];
}

export interface FileSessionSignal {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  promptHistory?: string[];
  toolNames: string[];
  changedFiles?: string[];
  resumeCommand?: string;
  diagnostics?: FileSessionDiagnostics;
}

export interface FileSignal {
  sessions: FileSessionSignal[];
  toolHistory: string[];
  promptHistory: string[];
}

export interface AggregatedSelectionSession {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  promptHistory: string[];
  toolNames: string[];
  resumeCommand?: string;
  changedFiles: string[];
  diagnostics?: FileSessionDiagnostics;
}

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  children: FileTreeNode[];
}

export interface SurfaceLink {
  kind: string;
  route: string;
  sourcePath: string;
}

export interface PageDetail {
  name: string;
  route: string;
  description: string;
  sourceFile: string;
}

export interface ApiDetail {
  group: string;
  method: string;
  endpoint: string;
  description: string;
  nextjsSourceFiles?: string[];
  rustSourceFiles?: string[];
  implementationSources?: Array<{
    label: string;
    sourceFiles: string[];
  }>;
}

export interface FeatureSurfacePage {
  route: string;
  title: string;
  description: string;
  sourceFile: string;
}

export interface FeatureSurfaceApi {
  domain: string;
  method: string;
  path: string;
  operationId: string;
  summary: string;
}

export interface FeatureSurfaceImplementationApi {
  label: string;
  domain: string;
  method: string;
  path: string;
  sourceFiles: string[];
}

export interface FeatureSurfaceMetadataGroup {
  id: string;
  name: string;
  description?: string;
}

export interface FeatureSurfaceMetadataItem {
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
}

export interface FeatureSurfaceMetadata {
  schemaVersion: number;
  capabilityGroups: FeatureSurfaceMetadataGroup[];
  features: FeatureSurfaceMetadataItem[];
}

export interface FeatureSurfaceIndexResponse {
  generatedAt: string;
  pages: FeatureSurfacePage[];
  apis: FeatureSurfaceApi[];
  contractApis: FeatureSurfaceApi[];
  nextjsApis: FeatureSurfaceImplementationApi[];
  rustApis: FeatureSurfaceImplementationApi[];
  implementationApis: FeatureSurfaceImplementationApi[];
  metadata: FeatureSurfaceMetadata | null;
  repoRoot: string;
  warnings: string[];
}

export interface FeatureListResponse {
  capabilityGroups: CapabilityGroup[];
  features: FeatureSummary[];
}

export type InspectorTab = "context" | "screenshot" | "api";
