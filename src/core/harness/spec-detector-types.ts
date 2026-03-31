export type SpecSourceKind = "native-tool" | "framework" | "tool-integration";

export type SpecSystem = "kiro" | "qoder" | "openspec" | "spec-kit" | "bmad";

export type SpecConfidence = "high" | "medium" | "low";

export type SpecStatus = "artifacts-present" | "installed-only" | "archived" | "legacy";

export type SpecArtifactType =
  | "requirements"
  | "bugfix"
  | "design"
  | "tasks"
  | "proposal"
  | "plan"
  | "spec"
  | "contract"
  | "data-model"
  | "research"
  | "quickstart"
  | "epic"
  | "story"
  | "context"
  | "prd"
  | "architecture"
  | "config"
  | "other";

export type SpecArtifact = {
  type: SpecArtifactType;
  path: string;
};

export type KiroConfig = {
  specId: string;
  workflowType?: string;
  specType?: string;
};

export type SpecFeature = {
  name: string;
  configKiro?: KiroConfig;
  documents: SpecArtifact[];
};

export type SpecSource = {
  kind: SpecSourceKind;
  system: SpecSystem;
  rootPath: string;
  confidence: SpecConfidence;
  status: SpecStatus;
  evidence: string[];
  children: SpecArtifact[];
  features?: SpecFeature[];
};

export type SpecDetectionResponse = {
  generatedAt: string;
  repoRoot: string;
  sources: SpecSource[];
  warnings: string[];
};
