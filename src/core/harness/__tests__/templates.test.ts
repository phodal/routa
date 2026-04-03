import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  doctorHarnessTemplates,
  listHarnessTemplates,
  validateHarnessTemplate,
} from "../templates";

function mkdirp(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath: string, content = "") {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

const MINIMAL_TEMPLATE = [
  "schema: harness-template-v1",
  "version: '0.1.0'",
  "id: test-web",
  "name: Test Web Template",
  "topology:",
  "  app_type: web",
  "  runtimes:",
  "    - nextjs",
  "  boundaries:",
  "    - path: src/app",
  "      role: presentation",
  "guides:",
  "  required:",
  "    - path: AGENTS.md",
  "      purpose: Contract",
  "  recommended:",
  "    - path: docs/adr/README.md",
  "      purpose: ADR index",
  "sensors:",
  "  fitness_manifest: docs/fitness/manifest.yaml",
  "  surfaces:",
  "    - docs/harness/build.yml",
  "automations:",
  "  ref: docs/harness/automations.yml",
  "specialists:",
  "  - id: harness-build",
  "    role: Build validation",
  "lifecycle_tiers:",
  "  fast:",
  "    description: Quick checks",
  "    column_gate: coding",
  "drift:",
  "  strategy: checksum-on-evidence-files",
  "  notify_on:",
  "    - guide_missing",
].join("\n");

describe("listHarnessTemplates", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-templates-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list with warning when templates directory is missing", async () => {
    const report = await listHarnessTemplates(tmpDir);
    expect(report.templates).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("Templates directory not found");
  });

  it("discovers template files and returns summaries", async () => {
    writeFile(
      path.join(tmpDir, "docs/harness/templates/test-web.yaml"),
      MINIMAL_TEMPLATE,
    );

    const report = await listHarnessTemplates(tmpDir);
    expect(report.templates).toHaveLength(1);
    expect(report.templates[0].id).toBe("test-web");
    expect(report.templates[0].appType).toBe("web");
    expect(report.templates[0].runtimes).toEqual(["nextjs"]);
  });
});

describe("validateHarnessTemplate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-templates-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports error drift when required guides are missing", async () => {
    writeFile(
      path.join(tmpDir, "docs/harness/templates/test-web.yaml"),
      MINIMAL_TEMPLATE,
    );

    const report = await validateHarnessTemplate(tmpDir, "test-web");
    expect(report.templateId).toBe("test-web");
    expect(report.overallDrift).toBe("error");
    expect(
      report.driftFindings.some(
        (f) => f.kind === "guide_missing" && f.path === "AGENTS.md",
      ),
    ).toBe(true);
  });

  it("reports healthy drift when all guides and sensors are present", async () => {
    writeFile(
      path.join(tmpDir, "docs/harness/templates/test-web.yaml"),
      MINIMAL_TEMPLATE,
    );
    writeFile(path.join(tmpDir, "AGENTS.md"), "# Agents");
    mkdirp(path.join(tmpDir, "src/app"));
    writeFile(path.join(tmpDir, "docs/adr/README.md"), "# ADRs");
    writeFile(
      path.join(tmpDir, "docs/fitness/manifest.yaml"),
      "schema: fitness-manifest-v1",
    );
    writeFile(
      path.join(tmpDir, "docs/harness/build.yml"),
      "schema: harness-surface-v1",
    );
    writeFile(
      path.join(tmpDir, "docs/harness/automations.yml"),
      "schema: harness-automation-v1",
    );

    const report = await validateHarnessTemplate(tmpDir, "test-web");
    expect(report.overallDrift).toBe("healthy");
    expect(report.driftFindings).toHaveLength(0);
    expect(report.boundaries).toEqual([
      { path: "src/app", role: "presentation", present: true },
    ]);
    expect(report.automationRef?.path).toBe("docs/harness/automations.yml");
    expect(report.driftPolicy?.strategy).toBe("checksum-on-evidence-files");
  });

  it("includes sensor checksums when files are present", async () => {
    writeFile(
      path.join(tmpDir, "docs/harness/templates/test-web.yaml"),
      MINIMAL_TEMPLATE,
    );
    writeFile(path.join(tmpDir, "AGENTS.md"), "# Agents");
    writeFile(path.join(tmpDir, "docs/adr/README.md"), "# ADRs");
    writeFile(
      path.join(tmpDir, "docs/fitness/manifest.yaml"),
      "schema: fitness-manifest-v1",
    );
    writeFile(
      path.join(tmpDir, "docs/harness/build.yml"),
      "schema: harness-surface-v1",
    );

    const report = await validateHarnessTemplate(tmpDir, "test-web");
    const manifest = report.sensorFiles.find(
      (s) => s.role === "fitness_manifest",
    );
    expect(manifest?.present).toBe(true);
    expect(manifest?.checksum).toBeDefined();
    expect(manifest?.checksum?.length).toBe(64);
  });

  it("throws when template id is not found", async () => {
    writeFile(
      path.join(tmpDir, "docs/harness/templates/test-web.yaml"),
      MINIMAL_TEMPLATE,
    );

    await expect(
      validateHarnessTemplate(tmpDir, "nonexistent"),
    ).rejects.toThrow("not found");
  });

  it("collects lifecycle tiers", async () => {
    writeFile(
      path.join(tmpDir, "docs/harness/templates/test-web.yaml"),
      MINIMAL_TEMPLATE,
    );

    const report = await validateHarnessTemplate(tmpDir, "test-web");
    expect(report.lifecycleTiers).toHaveLength(1);
    expect(report.lifecycleTiers[0].tier).toBe("fast");
    expect(report.lifecycleTiers[0].columnGate).toBe("coding");
  });
});

describe("doctorHarnessTemplates", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-templates-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates all templates in the directory", async () => {
    writeFile(
      path.join(tmpDir, "docs/harness/templates/test-web.yaml"),
      MINIMAL_TEMPLATE,
    );

    const report = await doctorHarnessTemplates(tmpDir);
    expect(report.templateReports).toHaveLength(1);
    expect(report.templateReports[0].templateId).toBe("test-web");
  });
});
