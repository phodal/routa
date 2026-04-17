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
  relatedFeatures: string[];
  domainObjects: string[];
  sessionCount: number;
  changedFiles: number;
  updatedAt: string;
  fileTree: FileTreeNode[];
  surfaceLinks?: SurfaceLink[];
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

export interface FeatureListResponse {
  capabilityGroups: CapabilityGroup[];
  features: FeatureSummary[];
}

export type InspectorTab = "context" | "screenshot" | "api";
