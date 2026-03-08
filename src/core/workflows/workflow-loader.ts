/**
 * WorkflowLoader — loads workflow definitions from YAML files.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { WorkflowDefinition } from "./workflow-types";

export class WorkflowLoader {
  private cache = new Map<string, WorkflowDefinition>();
  private flowsDir: string;

  constructor(flowsDir = "resources/flows") {
    this.flowsDir = flowsDir;
  }

  /**
   * Load a workflow definition from a YAML file.
   * @param idOrPath - Either a workflow ID (e.g., "pr-verify") or a full path
   */
  async load(idOrPath: string): Promise<WorkflowDefinition> {
    // Check cache first
    if (this.cache.has(idOrPath)) {
      return this.cache.get(idOrPath)!;
    }

    const filePath = this.resolveFilePath(idOrPath);
    const content = await fs.promises.readFile(filePath, "utf-8");
    const definition = this.parse(content, filePath);

    // Store in cache with both the original key and the resolved name
    this.cache.set(idOrPath, definition);
    this.cache.set(definition.name, definition);

    return definition;
  }

  /**
   * Load a workflow definition synchronously.
   */
  loadSync(idOrPath: string): WorkflowDefinition {
    if (this.cache.has(idOrPath)) {
      return this.cache.get(idOrPath)!;
    }

    const filePath = this.resolveFilePath(idOrPath);
    const content = fs.readFileSync(filePath, "utf-8");
    const definition = this.parse(content, filePath);

    this.cache.set(idOrPath, definition);
    this.cache.set(definition.name, definition);

    return definition;
  }

  /**
   * Parse a workflow definition from YAML content.
   */
  parse(content: string, source = "inline"): WorkflowDefinition {
    try {
      const raw = yaml.load(content) as Record<string, unknown>;
      return this.validate(raw, source);
    } catch (err) {
      throw new Error(`Failed to parse workflow YAML from ${source}: ${err}`, { cause: err });
    }
  }

  /**
   * List all available workflow IDs in the flows directory.
   */
  async listWorkflows(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.flowsDir);
      return files
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .map((f) => path.basename(f, path.extname(f)));
    } catch {
      return [];
    }
  }

  /**
   * Clear the workflow cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private resolveFilePath(idOrPath: string): string {
    // If it looks like a full path, use it directly
    if (idOrPath.includes("/") || idOrPath.includes("\\")) {
      return idOrPath;
    }
    // Otherwise, treat as a workflow ID and resolve from flows directory
    return path.join(this.flowsDir, `${idOrPath}.yaml`);
  }

  private validate(raw: Record<string, unknown>, source: string): WorkflowDefinition {
    if (!raw.name || typeof raw.name !== "string") {
      throw new Error(`Workflow from ${source} missing required field: name`);
    }
    if (!raw.steps || !Array.isArray(raw.steps) || raw.steps.length === 0) {
      throw new Error(`Workflow from ${source} must have at least one step`);
    }

    // Validate each step has required fields
    for (let i = 0; i < raw.steps.length; i++) {
      const step = raw.steps[i] as Record<string, unknown>;
      if (!step.name || typeof step.name !== "string") {
        throw new Error(`Step ${i} in workflow from ${source} missing required field: name`);
      }
      if (!step.specialist || typeof step.specialist !== "string") {
        throw new Error(`Step "${step.name}" in workflow from ${source} missing required field: specialist`);
      }
    }

    return {
      name: raw.name as string,
      description: raw.description as string | undefined,
      version: (raw.version as string) ?? "1.0",
      trigger: raw.trigger as WorkflowDefinition["trigger"],
      variables: raw.variables as Record<string, string> | undefined,
      steps: raw.steps as WorkflowDefinition["steps"],
    };
  }
}

// ─── Singleton instance ─────────────────────────────────────────────────────

let _defaultLoader: WorkflowLoader | undefined;

export function getWorkflowLoader(): WorkflowLoader {
  if (!_defaultLoader) {
    _defaultLoader = new WorkflowLoader();
  }
  return _defaultLoader;
}

