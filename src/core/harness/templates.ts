import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import yaml from "js-yaml";
import type {
  AutomationRefStatus,
  BoundaryStatus,
  DriftFinding,
  DriftLevel,
  DriftPolicy,
  DoctorReport,
  GateStatus,
  GuideStatus,
  HarnessTemplateSummary,
  LifecycleTier,
  SensorFileStatus,
  SpecialistBinding,
  TemplateListReport,
  TemplateValidationReport,
} from "./template-types";

const TEMPLATES_DIR = path.join("docs", "harness", "templates");

type BoundaryConfig = { path: string; role: string };
type TopologyConfig = {
  app_type: string;
  runtimes?: string[];
  protocols?: string[];
  boundaries?: BoundaryConfig[];
};
type GuideEntryConfig = { path: string; purpose?: string };
type GuidesConfig = {
  required?: GuideEntryConfig[];
  recommended?: GuideEntryConfig[];
};
type GateConfig = { id: string; command?: string; dimension?: string };
type HardGatesConfig = {
  fast?: GateConfig[];
  normal?: GateConfig[];
  full?: GateConfig[];
};
type SensorsConfig = {
  fitness_manifest?: string;
  review_triggers?: string;
  release_triggers?: string;
  surfaces?: string[];
  hard_gates?: HardGatesConfig;
};
type SpecialistBindingConfig = { id: string; role?: string };
type LifecycleTierConfig = { description?: string; column_gate?: string };
type DriftConfig = { strategy?: string; notify_on?: string[] };

type HarnessTemplateConfig = {
  schema: string;
  version?: string;
  id: string;
  name: string;
  description?: string;
  topology: TopologyConfig;
  guides?: GuidesConfig;
  sensors?: SensorsConfig;
  specialists?: SpecialistBindingConfig[];
  automations?: { ref?: string };
  lifecycle_tiers?: Record<string, LifecycleTierConfig>;
  drift?: DriftConfig;
};

function joinRepoPath(repoRoot: string, ...segments: string[]) {
  return path.join(/* turbopackIgnore: true */ repoRoot, ...segments);
}

function fileSha256(absolutePath: string): string | undefined {
  try {
    const content = fs.readFileSync(absolutePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return undefined;
  }
}

function tierOrder(tier: string): number {
  switch (tier) {
    case "fast": return 0;
    case "normal": return 1;
    case "full": return 2;
    default: return 3;
  }
}

async function loadTemplateConfig(
  absolutePath: string,
): Promise<HarnessTemplateConfig> {
  const raw = await fsp.readFile(absolutePath, "utf-8");
  const parsed = yaml.load(raw) as HarnessTemplateConfig;
  if (parsed.schema !== "harness-template-v1") {
    throw new Error(
      `Unexpected schema '${parsed.schema}'; expected 'harness-template-v1'`,
    );
  }
  return parsed;
}

async function loadAllTemplateConfigs(
  repoRoot: string,
  warnings: string[],
): Promise<Array<{ config: HarnessTemplateConfig; relPath: string }>> {
  const templatesDir = joinRepoPath(repoRoot, ...TEMPLATES_DIR.split(path.sep));
  if (!fs.existsSync(templatesDir) || !fs.statSync(templatesDir).isDirectory()) {
    warnings.push(`Templates directory not found: ${TEMPLATES_DIR}`);
    return [];
  }

  const entries = await fsp.readdir(templatesDir);
  const results: Array<{ config: HarnessTemplateConfig; relPath: string }> = [];

  for (const entry of entries) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
    const absolutePath = path.join(templatesDir, entry);
    try {
      const config = await loadTemplateConfig(absolutePath);
      results.push({ config, relPath: `${TEMPLATES_DIR}/${entry}` });
    } catch (error) {
      warnings.push(
        `Failed to parse ${entry}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  results.sort((a, b) => a.config.id.localeCompare(b.config.id));
  return results;
}

function checkGuides(
  repoRoot: string,
  config: HarnessTemplateConfig,
  driftFindings: DriftFinding[],
): GuideStatus[] {
  const results: GuideStatus[] = [];
  const guides = config.guides;
  if (!guides) return results;

  for (const guide of guides.required ?? []) {
    const present = fs.existsSync(joinRepoPath(repoRoot, guide.path));
    if (!present) {
      driftFindings.push({
        kind: "guide_missing",
        path: guide.path,
        message: `Required guide missing: ${guide.path}`,
        level: "error",
      });
    }
    results.push({ path: guide.path, purpose: guide.purpose, required: true, present });
  }

  for (const guide of guides.recommended ?? []) {
    const present = fs.existsSync(joinRepoPath(repoRoot, guide.path));
    if (!present) {
      driftFindings.push({
        kind: "guide_missing",
        path: guide.path,
        message: `Recommended guide missing: ${guide.path}`,
        level: "warning",
      });
    }
    results.push({ path: guide.path, purpose: guide.purpose, required: false, present });
  }

  return results;
}

function collectBoundaries(
  repoRoot: string,
  config: HarnessTemplateConfig,
): BoundaryStatus[] {
  return (config.topology.boundaries ?? []).map((boundary) => ({
    path: boundary.path,
    role: boundary.role,
    present: fs.existsSync(joinRepoPath(repoRoot, boundary.path)),
  }));
}

function checkSensorFiles(
  repoRoot: string,
  config: HarnessTemplateConfig,
  driftFindings: DriftFinding[],
): SensorFileStatus[] {
  const results: SensorFileStatus[] = [];
  const sensors = config.sensors;
  if (!sensors) return results;

  const sensorPaths: Array<{ relPath: string; role: string }> = [];
  if (sensors.fitness_manifest) sensorPaths.push({ relPath: sensors.fitness_manifest, role: "fitness_manifest" });
  if (sensors.review_triggers) sensorPaths.push({ relPath: sensors.review_triggers, role: "review_triggers" });
  if (sensors.release_triggers) sensorPaths.push({ relPath: sensors.release_triggers, role: "release_triggers" });

  for (const { relPath, role } of sensorPaths) {
    const abs = joinRepoPath(repoRoot, relPath);
    const present = fs.existsSync(abs);
    const checksum = present ? fileSha256(abs) : undefined;
    if (!present) {
      driftFindings.push({
        kind: "sensor_file_missing",
        path: relPath,
        message: `Sensor file missing: ${relPath}`,
        level: "error",
      });
    }
    results.push({ path: relPath, role, present, checksum });
  }

  for (const surfacePath of sensors.surfaces ?? []) {
    const abs = joinRepoPath(repoRoot, surfacePath);
    const present = fs.existsSync(abs);
    const checksum = present ? fileSha256(abs) : undefined;
    if (!present) {
      driftFindings.push({
        kind: "sensor_file_missing",
        path: surfacePath,
        message: `Surface definition missing: ${surfacePath}`,
        level: "error",
      });
    }
    results.push({ path: surfacePath, role: "surface", present, checksum });
  }

  return results;
}

function collectAutomationRef(
  repoRoot: string,
  config: HarnessTemplateConfig,
): AutomationRefStatus | undefined {
  const relPath = config.automations?.ref;
  if (!relPath) return undefined;

  const abs = joinRepoPath(repoRoot, relPath);
  const present = fs.existsSync(abs);
  return {
    path: relPath,
    present,
    checksum: present ? fileSha256(abs) : undefined,
  };
}

function collectGates(config: HarnessTemplateConfig): GateStatus[] {
  const gates: GateStatus[] = [];
  const hardGates = config.sensors?.hard_gates;
  if (!hardGates) return gates;

  for (const gate of hardGates.fast ?? []) {
    gates.push({ id: gate.id, tier: "fast", command: gate.command, dimension: gate.dimension });
  }
  for (const gate of hardGates.normal ?? []) {
    gates.push({ id: gate.id, tier: "normal", command: gate.command, dimension: gate.dimension });
  }
  for (const gate of hardGates.full ?? []) {
    gates.push({ id: gate.id, tier: "full", command: gate.command, dimension: gate.dimension });
  }

  return gates;
}

function checkSpecialists(
  repoRoot: string,
  config: HarnessTemplateConfig,
): SpecialistBinding[] {
  return (config.specialists ?? []).map((spec) => {
    const toolsPath = joinRepoPath(repoRoot, "resources", "specialists", "tools", `${spec.id}.yaml`);
    const harnessPath = joinRepoPath(repoRoot, "resources", "specialists", "harness", `${spec.id}.yaml`);
    return {
      id: spec.id,
      role: spec.role,
      yamlExists: fs.existsSync(toolsPath) || fs.existsSync(harnessPath),
    };
  });
}

function collectLifecycleTiers(
  config: HarnessTemplateConfig,
  gates: GateStatus[],
): LifecycleTier[] {
  const tiers = config.lifecycle_tiers;
  if (!tiers) return [];

  return Object.entries(tiers)
    .map(([tierName, tierConfig]) => ({
      tier: tierName,
      description: tierConfig.description,
      columnGate: tierConfig.column_gate,
      gateCount: gates.filter((g) => g.tier === tierName).length,
    }))
    .sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier));
}

function collectDriftPolicy(
  config: HarnessTemplateConfig,
): DriftPolicy | undefined {
  if (!config.drift) return undefined;
  return {
    strategy: config.drift.strategy,
    notifyOn: config.drift.notify_on ?? [],
  };
}

function resolveOverallDrift(findings: DriftFinding[]): DriftLevel {
  if (findings.some((f) => f.level === "error")) return "error";
  if (findings.some((f) => f.level === "warning")) return "warning";
  return "healthy";
}

function buildValidationReport(
  repoRoot: string,
  config: HarnessTemplateConfig,
  configPath: string,
): TemplateValidationReport {
  const driftFindings: DriftFinding[] = [];
  const guides = checkGuides(repoRoot, config, driftFindings);
  const boundaries = collectBoundaries(repoRoot, config);
  const sensorFiles = checkSensorFiles(repoRoot, config, driftFindings);
  const automationRef = collectAutomationRef(repoRoot, config);
  const gates = collectGates(config);
  const specialists = checkSpecialists(repoRoot, config);
  const lifecycleTiers = collectLifecycleTiers(config, gates);
  const driftPolicy = collectDriftPolicy(config);

  return {
    generatedAt: new Date().toISOString(),
    templateId: config.id,
    templateName: config.name,
    templateVersion: config.version,
    configPath,
    appType: config.topology.app_type,
    runtimes: config.topology.runtimes ?? [],
    protocols: config.topology.protocols ?? [],
    guides,
    boundaries,
    sensorFiles,
    automationRef,
    gates,
    specialists,
    lifecycleTiers,
    driftPolicy,
    driftFindings,
    overallDrift: resolveOverallDrift(driftFindings),
    warnings: [],
  };
}

export async function listHarnessTemplates(
  repoRoot: string,
): Promise<TemplateListReport> {
  const warnings: string[] = [];
  const configs = await loadAllTemplateConfigs(repoRoot, warnings);

  const templates: HarnessTemplateSummary[] = configs.map(({ config, relPath }) => ({
    id: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    appType: config.topology.app_type,
    runtimes: config.topology.runtimes ?? [],
    configPath: relPath,
  }));

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    templates,
    warnings,
  };
}

export async function validateHarnessTemplate(
  repoRoot: string,
  templateId: string,
): Promise<TemplateValidationReport> {
  const warnings: string[] = [];
  const configs = await loadAllTemplateConfigs(repoRoot, warnings);
  const match = configs.find(({ config }) => config.id === templateId);

  if (!match) {
    throw new Error(
      `Template '${templateId}' not found in ${TEMPLATES_DIR}`,
    );
  }

  return buildValidationReport(repoRoot, match.config, match.relPath);
}

export async function doctorHarnessTemplates(
  repoRoot: string,
): Promise<DoctorReport> {
  const warnings: string[] = [];
  const configs = await loadAllTemplateConfigs(repoRoot, warnings);

  const templateReports: TemplateValidationReport[] = [];
  for (const { config, relPath } of configs) {
    try {
      templateReports.push(buildValidationReport(repoRoot, config, relPath));
    } catch (error) {
      warnings.push(
        `Failed to validate ${config.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    templateReports,
    warnings,
  };
}
