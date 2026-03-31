import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectSpecSources } from "../spec-detector";

function mkdirp(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath: string, content = "") {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

describe("detectSpecSources", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-detector-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -- Kiro --

  it("detects Kiro native spec with artifacts and features", () => {
    writeFile(path.join(tmpDir, ".kiro/specs/auth/requirements.md"), "# Auth requirements");
    writeFile(path.join(tmpDir, ".kiro/specs/auth/design.md"), "# Auth design");
    writeFile(path.join(tmpDir, ".kiro/specs/auth/tasks.md"), "# Auth tasks");
    writeFile(
      path.join(tmpDir, ".kiro/specs/auth/.config.kiro"),
      JSON.stringify({ specId: "abc123", workflowType: "design-first", specType: "feature" }),
    );

    const result = detectSpecSources(tmpDir);
    const kiroSource = result.sources.find((s) => s.system === "kiro" && s.kind === "native-tool");

    expect(kiroSource).toBeDefined();
    expect(kiroSource!.confidence).toBe("high");
    expect(kiroSource!.status).toBe("artifacts-present");
    expect(kiroSource!.children.length).toBe(3);
    expect(kiroSource!.children.map((c) => c.type)).toContain("requirements");
    expect(kiroSource!.children.map((c) => c.type)).toContain("design");
    expect(kiroSource!.children.map((c) => c.type)).toContain("tasks");

    // 3-tier hierarchy
    expect(kiroSource!.features).toBeDefined();
    expect(kiroSource!.features!.length).toBe(1);
    expect(kiroSource!.features![0].name).toBe("auth");
    expect(kiroSource!.features![0].documents.length).toBe(3);
    expect(kiroSource!.features![0].configKiro).toBeDefined();
    expect(kiroSource!.features![0].configKiro!.specId).toBe("abc123");
    expect(kiroSource!.features![0].configKiro!.workflowType).toBe("design-first");
    expect(kiroSource!.features![0].configKiro!.specType).toBe("feature");
  });

  it("detects Kiro integration-only when no specs exist", () => {
    mkdirp(path.join(tmpDir, ".kiro/prompts"));
    mkdirp(path.join(tmpDir, ".kiro/skills"));

    const result = detectSpecSources(tmpDir);
    const kiroSource = result.sources.find((s) => s.system === "kiro");

    expect(kiroSource).toBeDefined();
    expect(kiroSource!.kind).toBe("tool-integration");
    expect(kiroSource!.status).toBe("installed-only");
    expect(kiroSource!.confidence).toBe("low");
  });

  it("marks Kiro as native-tool when specs dir exists but is empty", () => {
    mkdirp(path.join(tmpDir, ".kiro/specs"));

    const result = detectSpecSources(tmpDir);
    const kiroSource = result.sources.find((s) => s.system === "kiro");

    expect(kiroSource).toBeDefined();
    expect(kiroSource!.kind).toBe("native-tool");
    expect(kiroSource!.status).toBe("installed-only");
    expect(kiroSource!.confidence).toBe("medium");
  });

  // -- Qoder --

  it("detects Qoder native specs in .qoder/specs/", () => {
    writeFile(path.join(tmpDir, ".qoder/specs/my-feature.md"), "# My feature spec");
    writeFile(path.join(tmpDir, ".qoder/specs/another-feature.md"), "# Another feature");
    mkdirp(path.join(tmpDir, ".qoder/commands"));

    const result = detectSpecSources(tmpDir);
    const nativeSource = result.sources.find((s) => s.system === "qoder" && s.kind === "native-tool");

    expect(nativeSource).toBeDefined();
    expect(nativeSource!.confidence).toBe("high");
    expect(nativeSource!.status).toBe("artifacts-present");
    expect(nativeSource!.children.length).toBe(2);
    expect(nativeSource!.evidence).toContain(".qoder/specs/my-feature.md");

    // Should also detect integration
    const integrationSource = result.sources.find((s) => s.system === "qoder" && s.kind === "tool-integration");
    expect(integrationSource).toBeDefined();
    expect(integrationSource!.status).toBe("installed-only");
  });

  it("detects Qoder as integration-only when no specs exist", () => {
    mkdirp(path.join(tmpDir, ".qoder/commands"));
    mkdirp(path.join(tmpDir, ".qoder/skills"));
    mkdirp(path.join(tmpDir, ".qoder/rules"));

    const result = detectSpecSources(tmpDir);
    const qoderSource = result.sources.find((s) => s.system === "qoder");

    expect(qoderSource).toBeDefined();
    expect(qoderSource!.kind).toBe("tool-integration");
    expect(qoderSource!.status).toBe("installed-only");
    expect(qoderSource!.confidence).toBe("low");
    expect(qoderSource!.evidence).toContain(".qoder/commands/");
    expect(qoderSource!.evidence).toContain(".qoder/skills/");
    expect(qoderSource!.evidence).toContain(".qoder/rules/");
  });

  it("returns nothing for Qoder when dir does not exist", () => {
    const result = detectSpecSources(tmpDir);
    expect(result.sources.find((s) => s.system === "qoder")).toBeUndefined();
  });

  // -- OpenSpec --

  it("detects OpenSpec with spec artifacts", () => {
    writeFile(path.join(tmpDir, "openspec/config.yaml"), "name: test");
    writeFile(path.join(tmpDir, "openspec/specs/auth/spec.md"), "# Auth spec");
    writeFile(path.join(tmpDir, "openspec/changes/v1/proposal.md"), "# V1 proposal");
    writeFile(path.join(tmpDir, "openspec/changes/v1/design.md"), "# V1 design");

    const result = detectSpecSources(tmpDir);
    const osSource = result.sources.find((s) => s.system === "openspec" && s.kind === "framework");

    expect(osSource).toBeDefined();
    expect(osSource!.confidence).toBe("high");
    expect(osSource!.status).toBe("artifacts-present");
    expect(osSource!.children.length).toBeGreaterThanOrEqual(4);
  });

  it("detects OpenSpec as medium confidence with config only", () => {
    writeFile(path.join(tmpDir, "openspec/config.yaml"), "name: test");

    const result = detectSpecSources(tmpDir);
    const osSource = result.sources.find((s) => s.system === "openspec");

    expect(osSource).toBeDefined();
    expect(osSource!.confidence).toBe("medium");
    expect(osSource!.status).toBe("installed-only");
  });

  // -- Spec Kit --

  it("detects Spec Kit via .specify/specs/", () => {
    writeFile(path.join(tmpDir, ".specify/memory/constitution.md"), "# Constitution");
    writeFile(path.join(tmpDir, ".specify/specs/auth/spec.md"), "# Auth spec");
    writeFile(path.join(tmpDir, ".specify/specs/auth/tasks.md"), "# Auth tasks");

    const result = detectSpecSources(tmpDir);
    const skSource = result.sources.find((s) => s.system === "spec-kit");

    expect(skSource).toBeDefined();
    expect(skSource!.kind).toBe("framework");
    expect(skSource!.confidence).toBe("high");
    expect(skSource!.status).toBe("artifacts-present");
    expect(skSource!.children.length).toBeGreaterThanOrEqual(3);
  });

  it("detects Spec Kit via compat specs/ path", () => {
    writeFile(path.join(tmpDir, "specs/auth/spec.md"), "# Auth");
    writeFile(path.join(tmpDir, "specs/auth/plan.md"), "# Plan");
    writeFile(path.join(tmpDir, "specs/auth/tasks.md"), "# Tasks");

    const result = detectSpecSources(tmpDir);
    const skSource = result.sources.find((s) => s.system === "spec-kit");

    expect(skSource).toBeDefined();
    expect(skSource!.confidence).toBe("high");
    expect(skSource!.status).toBe("artifacts-present");
  });

  it("detects Spec Kit as medium when only framework exists", () => {
    writeFile(path.join(tmpDir, ".specify/memory/constitution.md"), "# Constitution");
    mkdirp(path.join(tmpDir, ".specify/templates"));

    const result = detectSpecSources(tmpDir);
    const skSource = result.sources.find((s) => s.system === "spec-kit");

    expect(skSource).toBeDefined();
    expect(skSource!.confidence).toBe("medium");
    expect(skSource!.status).toBe("installed-only");
  });

  // -- BMAD --

  it("detects BMAD v6 with planning artifacts", () => {
    mkdirp(path.join(tmpDir, "_bmad/_config"));
    mkdirp(path.join(tmpDir, "_bmad/core"));
    writeFile(path.join(tmpDir, "_bmad-output/planning-artifacts/PRD.md"), "# PRD");
    writeFile(path.join(tmpDir, "_bmad-output/planning-artifacts/architecture.md"), "# Arch");
    writeFile(path.join(tmpDir, "_bmad-output/planning-artifacts/epics/epic-1.md"), "# Epic 1");
    writeFile(path.join(tmpDir, "_bmad-output/project-context.md"), "# Context");

    const result = detectSpecSources(tmpDir);
    const bmadSource = result.sources.find((s) => s.system === "bmad" && s.kind === "framework");

    expect(bmadSource).toBeDefined();
    expect(bmadSource!.confidence).toBe("high");
    expect(bmadSource!.status).toBe("artifacts-present");
    expect(bmadSource!.children.length).toBeGreaterThanOrEqual(4);
    expect(bmadSource!.children.map((c) => c.type)).toContain("prd");
    expect(bmadSource!.children.map((c) => c.type)).toContain("architecture");
    expect(bmadSource!.children.map((c) => c.type)).toContain("epic");
  });

  it("detects BMAD as medium when only _bmad/ exists", () => {
    mkdirp(path.join(tmpDir, "_bmad/_config"));

    const result = detectSpecSources(tmpDir);
    const bmadSource = result.sources.find((s) => s.system === "bmad");

    expect(bmadSource).toBeDefined();
    expect(bmadSource!.confidence).toBe("medium");
    expect(bmadSource!.status).toBe("installed-only");
  });

  it("detects legacy BMAD docs without tool folders and keeps the framework kind", () => {
    writeFile(path.join(tmpDir, "docs/prd.md"), "# PRD");
    writeFile(path.join(tmpDir, "docs/architecture.md"), "# Architecture");

    const result = detectSpecSources(tmpDir);
    const bmadSource = result.sources.find((s) => s.system === "bmad");

    expect(bmadSource).toBeDefined();
    expect(bmadSource!.kind).toBe("framework");
    expect(bmadSource!.status).toBe("legacy");
    expect(bmadSource!.confidence).toBe("low");
    expect(bmadSource!.children.map((c) => c.type)).toEqual(expect.arrayContaining(["prd", "architecture"]));
  });

  it("bumps legacy BMAD confidence when tool integration evidence is present", () => {
    writeFile(path.join(tmpDir, "docs/prd.md"), "# PRD");
    mkdirp(path.join(tmpDir, ".claude/skills/bmad-planner"));

    const result = detectSpecSources(tmpDir);
    const bmadSource = result.sources.find((s) => s.system === "bmad");

    expect(bmadSource).toBeDefined();
    expect(bmadSource!.kind).toBe("framework");
    expect(bmadSource!.status).toBe("legacy");
    expect(bmadSource!.confidence).toBe("medium");
    expect(bmadSource!.evidence).toContain(".claude/skills/bmad-planner/");
  });

  it("does not treat ADR markdown alone as BMAD legacy evidence", () => {
    writeFile(path.join(tmpDir, "docs/adr/0001-example.md"), "# ADR");

    const result = detectSpecSources(tmpDir);
    const bmadSource = result.sources.find((s) => s.system === "bmad");

    expect(bmadSource).toBeUndefined();
  });

  // -- Multiple sources --

  it("supports multiple sources coexisting", () => {
    // Kiro native spec
    writeFile(path.join(tmpDir, ".kiro/specs/auth/requirements.md"), "# Req");
    // OpenSpec framework
    writeFile(path.join(tmpDir, "openspec/specs/domain/spec.md"), "# Spec");
    writeFile(path.join(tmpDir, "openspec/config.yaml"), "name: test");
    // Qoder integration
    mkdirp(path.join(tmpDir, ".qoder/commands"));

    const result = detectSpecSources(tmpDir);

    expect(result.sources.filter((s) => s.system === "kiro")).toHaveLength(1);
    expect(result.sources.filter((s) => s.system === "openspec")).toHaveLength(1);
    expect(result.sources.filter((s) => s.system === "qoder")).toHaveLength(1);
    expect(result.sources.length).toBeGreaterThanOrEqual(3);
  });

  // -- No false positives --

  it("does not report spec artifacts for integration-only repo", () => {
    mkdirp(path.join(tmpDir, ".qoder/commands"));
    mkdirp(path.join(tmpDir, ".kiro/prompts"));

    const result = detectSpecSources(tmpDir);
    const artifactSources = result.sources.filter((s) => s.status === "artifacts-present");

    expect(artifactSources).toHaveLength(0);
  });

  it("returns empty sources for a bare repo", () => {
    const result = detectSpecSources(tmpDir);
    expect(result.sources).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // -- OpenSpec archive handling --

  it("handles OpenSpec changes/archive correctly", () => {
    writeFile(path.join(tmpDir, "openspec/config.yaml"), "name: test");
    mkdirp(path.join(tmpDir, "openspec/changes/archive"));
    writeFile(path.join(tmpDir, "openspec/changes/v2/proposal.md"), "# V2");

    const result = detectSpecSources(tmpDir);
    const osSource = result.sources.find((s) => s.system === "openspec");

    expect(osSource).toBeDefined();
    expect(osSource!.evidence).toContain("openspec/changes/archive/ (archived)");
    // Archive dir should not generate artifacts
    const archiveArtifacts = osSource!.children.filter((c) => c.path.includes("archive"));
    expect(archiveArtifacts).toHaveLength(0);
  });
});
