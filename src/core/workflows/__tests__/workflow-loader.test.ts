/**
 * Unit tests for WorkflowLoader
 *
 * Tests YAML parsing, validation, and caching.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorkflowLoader } from "../workflow-loader";

describe("WorkflowLoader", () => {
  let loader: WorkflowLoader;

  beforeEach(() => {
    loader = new WorkflowLoader();
    loader.clearCache();
  });

  describe("parse", () => {
    it("should parse a minimal workflow definition", () => {
      const yaml = `
name: "Test Flow"
steps:
  - name: "Step 1"
    specialist: "developer"
`;
      const def = loader.parse(yaml);
      expect(def.name).toBe("Test Flow");
      expect(def.steps).toHaveLength(1);
      expect(def.steps[0].name).toBe("Step 1");
      expect(def.steps[0].specialist).toBe("developer");
    });

    it("should parse a full workflow definition with all fields", () => {
      const yaml = `
name: "SDLC Flow"
description: "End-to-end development"
version: "2.0"
trigger:
  type: webhook
  source: github
  event: pull_request.opened
variables:
  model: "claude-sonnet"
  base_url: "https://api.anthropic.com"
steps:
  - name: "Analyze"
    specialist: "analyzer"
    adapter: "claude-code-sdk"
    config:
      model: "\${model}"
    input: "Analyze this: \${trigger.payload}"
    output_key: "analysis"
  - name: "Implement"
    specialist: "developer"
    input: "\${steps.Analyze.output}"
    parallel_group: "dev-group"
`;
      const def = loader.parse(yaml);
      expect(def.name).toBe("SDLC Flow");
      expect(def.description).toBe("End-to-end development");
      expect(def.version).toBe("2.0");
      expect(def.trigger?.type).toBe("webhook");
      expect(def.trigger?.source).toBe("github");
      expect(def.trigger?.event).toBe("pull_request.opened");
      expect(def.variables?.model).toBe("claude-sonnet");
      expect(def.steps).toHaveLength(2);
      expect(def.steps[0].output_key).toBe("analysis");
      expect(def.steps[1].parallel_group).toBe("dev-group");
    });

    it("should throw on missing name", () => {
      const yaml = `
steps:
  - name: "Step 1"
    specialist: "developer"
`;
      expect(() => loader.parse(yaml)).toThrow("missing required field: name");
    });

    it("should throw on missing steps", () => {
      const yaml = `
name: "Test Flow"
`;
      expect(() => loader.parse(yaml)).toThrow("must have at least one step");
    });

    it("should throw on step missing name", () => {
      const yaml = `
name: "Test Flow"
steps:
  - specialist: "developer"
`;
      expect(() => loader.parse(yaml)).toThrow("Step 0 in workflow from inline missing required field: name");
    });

    it("should throw on step missing specialist", () => {
      const yaml = `
name: "Test Flow"
steps:
  - name: "Step 1"
`;
      expect(() => loader.parse(yaml)).toThrow('Step "Step 1" in workflow from inline missing required field: specialist');
    });
  });

  describe("load from file", () => {
    it("should load the code-review workflow", async () => {
      const fileLoader = new WorkflowLoader("resources/flows");
      const def = await fileLoader.load("code-review");
      expect(def.name).toBe("Code Review Flow");
      expect(def.version).toBe("2.0");
      expect(def.variables?.confidence_threshold).toBe("7");
      expect(def.steps).toHaveLength(4);
      expect(def.steps.map(step => step.name)).toEqual([
        "Phase 1 - Context Gathering",
        "Phase 2 - Diff Analysis",
        "Phase 3 - False Positive Filter",
        "Phase 4 - Final Review Report",
      ]);

      expect(def.steps[0].specialist).toBe("pr-reviewer");
      expect(def.steps[1].specialist).toBe("pr-reviewer");
      expect(def.steps[2].specialist).toBe("gate");
      expect(def.steps[3].specialist).toBe("pr-analyzer");

      expect(def.steps[2].input).toContain("confidence >= ${confidence_threshold}");
      expect(def.steps[3].input).toContain("No significant issues found");
    });

    it("should load the pr-verify workflow", async () => {
      const fileLoader = new WorkflowLoader("resources/flows");
      const def = await fileLoader.load("pr-verify");
      expect(def.name).toBe("PR Verification Flow");
      expect(def.steps.length).toBe(4);
      expect(def.trigger?.type).toBe("webhook");
      expect(def.trigger?.source).toBe("github");
    });

    it("should cache loaded workflows", async () => {
      const fileLoader = new WorkflowLoader("resources/flows");
      const def1 = await fileLoader.load("code-review");
      const def2 = await fileLoader.load("code-review");
      expect(def1).toBe(def2); // Same object reference (cached)
    });
  });

  describe("listWorkflows", () => {
    it("should list available workflows", async () => {
      const fileLoader = new WorkflowLoader("resources/flows");
      const workflows = await fileLoader.listWorkflows();
      expect(workflows).toContain("code-review");
      expect(workflows).toContain("pr-verify");
    });
  });
});
