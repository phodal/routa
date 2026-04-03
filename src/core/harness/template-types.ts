export type GuideStatus = {
  path: string;
  purpose?: string;
  required: boolean;
  present: boolean;
};

export type BoundaryStatus = {
  path: string;
  role: string;
  present: boolean;
};

export type SensorFileStatus = {
  path: string;
  role: string;
  present: boolean;
  checksum?: string;
};

export type AutomationRefStatus = {
  path: string;
  present: boolean;
  checksum?: string;
};

export type GateStatus = {
  id: string;
  tier: string;
  command?: string;
  dimension?: string;
};

export type SpecialistBinding = {
  id: string;
  role?: string;
  yamlExists: boolean;
};

export type LifecycleTier = {
  tier: string;
  description?: string;
  columnGate?: string;
  gateCount: number;
};

export type DriftLevel = "healthy" | "warning" | "error";

export type DriftFinding = {
  kind: string;
  path: string;
  message: string;
  level: DriftLevel;
};

export type DriftPolicy = {
  strategy?: string;
  notifyOn: string[];
};

export type HarnessTemplateSummary = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  appType: string;
  runtimes: string[];
  configPath: string;
};

export type TemplateValidationReport = {
  generatedAt: string;
  templateId: string;
  templateName: string;
  templateVersion?: string;
  configPath: string;
  appType: string;
  runtimes: string[];
  protocols: string[];
  guides: GuideStatus[];
  boundaries: BoundaryStatus[];
  sensorFiles: SensorFileStatus[];
  automationRef?: AutomationRefStatus;
  gates: GateStatus[];
  specialists: SpecialistBinding[];
  lifecycleTiers: LifecycleTier[];
  driftPolicy?: DriftPolicy;
  driftFindings: DriftFinding[];
  overallDrift: DriftLevel;
  warnings: string[];
};

export type TemplateListReport = {
  generatedAt: string;
  repoRoot: string;
  templates: HarnessTemplateSummary[];
  warnings: string[];
};

export type DoctorReport = {
  generatedAt: string;
  repoRoot: string;
  templateReports: TemplateValidationReport[];
  warnings: string[];
};
