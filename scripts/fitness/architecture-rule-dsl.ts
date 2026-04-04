#!/usr/bin/env node
/**
 * architecture-rule-dsl.ts
 *
 * Parser and compiler for the Routa Architecture Rule DSL.
 *
 * The DSL is a YAML file (*.archdsl.yaml) that describes architecture rules in a
 * language-agnostic format. This module:
 *   1. Parses and validates the YAML DSL.
 *   2. Compiles it to ArchUnitTS rule definitions.
 *   3. Can be imported by check-backend-architecture.ts.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { isDirectExecution } from "../lib/cli";
import { fromRoot } from "../lib/paths";

// ──────────────────────────── DSL types ──────────────────────────────────────

export type ArchDslVersion = "1";

export type RuleSuite = "boundaries" | "cycles";

export type ConstraintType = "must_not_depend_on" | "no_cycles";

export interface FolderRef {
  folder: string;
}

export interface BoundaryConstraint {
  type: "must_not_depend_on";
  target: FolderRef;
}

export interface CycleConstraint {
  type: "no_cycles";
}

export type RuleConstraint = BoundaryConstraint | CycleConstraint;

export interface ArchDslRule {
  id: string;
  title: string;
  suite: RuleSuite;
  source: FolderRef;
  constraint: RuleConstraint;
}

export interface ArchDslFile {
  version: ArchDslVersion;
  name: string;
  description: string;
  rules: ArchDslRule[];
}

// ──────────────────────────── Validation ─────────────────────────────────────

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult =
  | { valid: true; dsl: ArchDslFile }
  | { valid: false; errors: ValidationError[] };

export function validateDsl(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, errors: [{ field: "root", message: "DSL must be an object" }] };
  }

  const obj = raw as Record<string, unknown>;

  if (obj["version"] !== "1") {
    errors.push({ field: "version", message: `version must be "1", got ${String(obj["version"])}` });
  }

  if (typeof obj["name"] !== "string" || !obj["name"]) {
    errors.push({ field: "name", message: "name must be a non-empty string" });
  }

  if (typeof obj["description"] !== "string") {
    errors.push({ field: "description", message: "description must be a string" });
  }

  if (!Array.isArray(obj["rules"])) {
    errors.push({ field: "rules", message: "rules must be an array" });
    return { valid: false, errors };
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < (obj["rules"] as unknown[]).length; i++) {
    const rule = (obj["rules"] as unknown[])[i] as Record<string, unknown>;
    const prefix = `rules[${i}]`;

    if (typeof rule["id"] !== "string" || !rule["id"]) {
      errors.push({ field: `${prefix}.id`, message: "id must be a non-empty string" });
    } else {
      if (seenIds.has(rule["id"] as string)) {
        errors.push({ field: `${prefix}.id`, message: `duplicate id: ${rule["id"] as string}` });
      }
      seenIds.add(rule["id"] as string);
    }

    if (typeof rule["title"] !== "string" || !rule["title"]) {
      errors.push({ field: `${prefix}.title`, message: "title must be a non-empty string" });
    }

    if (rule["suite"] !== "boundaries" && rule["suite"] !== "cycles") {
      errors.push({ field: `${prefix}.suite`, message: `suite must be "boundaries" or "cycles"` });
    }

    const source = rule["source"] as Record<string, unknown> | null | undefined;
    if (!source || typeof source["folder"] !== "string" || !source["folder"]) {
      errors.push({ field: `${prefix}.source.folder`, message: "source.folder must be a non-empty string" });
    }

    const constraint = rule["constraint"] as Record<string, unknown> | null | undefined;
    if (!constraint) {
      errors.push({ field: `${prefix}.constraint`, message: "constraint is required" });
    } else {
      if (
        constraint["type"] !== "must_not_depend_on" &&
        constraint["type"] !== "no_cycles"
      ) {
        errors.push({
          field: `${prefix}.constraint.type`,
          message: `constraint.type must be "must_not_depend_on" or "no_cycles"`,
        });
      }

      if (constraint["type"] === "must_not_depend_on") {
        const target = constraint["target"] as Record<string, unknown> | null | undefined;
        if (!target || typeof target["folder"] !== "string" || !target["folder"]) {
          errors.push({
            field: `${prefix}.constraint.target.folder`,
            message: "target.folder is required for must_not_depend_on constraints",
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, dsl: raw as ArchDslFile };
}

// ──────────────────────────── File loading ───────────────────────────────────

export function loadDslFile(filePath: string): ValidationResult {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      errors: [{ field: "file", message: `DSL file not found: ${filePath}` }],
    };
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    raw = yaml.load(content);
  } catch (err) {
    return {
      valid: false,
      errors: [{ field: "file", message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }

  return validateDsl(raw);
}

// ──────────────────────────── Compiler ───────────────────────────────────────

export interface CompiledRule {
  id: string;
  title: string;
  suite: RuleSuite;
  /** Human-readable description of what ArchUnitTS check to apply. */
  archUnitDescription: string;
}

export interface CompileResult {
  name: string;
  description: string;
  rules: CompiledRule[];
}

/**
 * Compile a validated DSL file to ArchUnitTS rule descriptors.
 * The actual ArchUnitTS `projectFiles()` calls are performed in
 * check-backend-architecture.ts by interpreting the compiled descriptors.
 */
export function compileDsl(dsl: ArchDslFile): CompileResult {
  const rules: CompiledRule[] = dsl.rules.map((rule) => {
    let archUnitDescription: string;

    if (rule.constraint.type === "must_not_depend_on") {
      archUnitDescription =
        `files in "${rule.source.folder}" must not depend on files in "${rule.constraint.target.folder}"`;
    } else {
      archUnitDescription = `files in "${rule.source.folder}" must have no circular dependencies`;
    }

    return {
      id: rule.id,
      title: rule.title,
      suite: rule.suite,
      archUnitDescription,
    };
  });

  return { name: dsl.name, description: dsl.description, rules };
}

// ──────────────────────────── Report ─────────────────────────────────────────

export interface ArchDslReport {
  generatedAt: string;
  dslFile: string;
  name: string;
  description: string;
  valid: boolean;
  ruleCount: number;
  rules: CompiledRule[];
  errors: ValidationError[];
}

export function buildReport(dslFilePath: string): ArchDslReport {
  const result = loadDslFile(dslFilePath);

  if (!result.valid) {
    return {
      generatedAt: new Date().toISOString(),
      dslFile: dslFilePath,
      name: "",
      description: "",
      valid: false,
      ruleCount: 0,
      rules: [],
      errors: result.errors,
    };
  }

  const compiled = compileDsl(result.dsl);

  return {
    generatedAt: new Date().toISOString(),
    dslFile: dslFilePath,
    name: compiled.name,
    description: compiled.description,
    valid: true,
    ruleCount: compiled.rules.length,
    rules: compiled.rules,
    errors: [],
  };
}

// ──────────────────────────── CLI entry ──────────────────────────────────────

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function resolveDefaultDslPath(): string {
  return fromRoot("architecture/rules/backend-core.archdsl.yaml");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const fileArg = argv.find((a) => !a.startsWith("--"));
  const dslPath = fileArg ? path.resolve(fileArg) : resolveDefaultDslPath();

  const report = buildReport(dslPath);

  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (!report.valid) {
      console.error(`DSL validation failed for: ${report.dslFile}`);
      for (const error of report.errors) {
        console.error(`  [${error.field}] ${error.message}`);
      }
    } else {
      console.log(`DSL: ${report.name} — ${report.description}`);
      console.log(`Rules (${report.ruleCount}):`);
      for (const rule of report.rules) {
        console.log(`  [${rule.suite}] ${rule.id}: ${rule.archUnitDescription}`);
      }
    }
  }

  return report.valid ? 0 : 1;
}

if (isDirectExecution(import.meta.url)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
