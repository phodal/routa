export type DesignDecisionSourceKind = "canonical-doc" | "decision-records";

export type DesignDecisionConfidence = "high" | "medium" | "low";

export type DesignDecisionSourceStatus = "documents-present" | "missing";

export type DesignDecisionStatus =
  | "canonical"
  | "accepted"
  | "superseded"
  | "deprecated"
  | "unknown";

export type DesignDecisionArtifactType = "architecture" | "adr";

export type DesignDecisionArtifact = {
  id: string;
  title: string;
  path: string;
  type: DesignDecisionArtifactType;
  status: DesignDecisionStatus;
  summary: string | null;
  codeRefs: string[];
};

export type DesignDecisionSource = {
  kind: DesignDecisionSourceKind;
  label: string;
  rootPath: string;
  confidence: DesignDecisionConfidence;
  status: DesignDecisionSourceStatus;
  artifacts: DesignDecisionArtifact[];
};

export type DesignDecisionResponse = {
  generatedAt: string;
  repoRoot: string;
  sources: DesignDecisionSource[];
  warnings: string[];
};
