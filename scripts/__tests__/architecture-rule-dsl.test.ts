import { describe, expect, it } from "vitest";
import path from "node:path";
import { fromRoot } from "../lib/paths";
import {
  validateDsl,
  loadDslFile,
  compileDsl,
  buildReport,
  type ArchDslFile,
  type ArchDslReport,
} from "../fitness/architecture-rule-dsl";

const CANONICAL_DSL_PATH = fromRoot("architecture/rules/backend-core.archdsl.yaml");

describe("validateDsl", () => {
  it("accepts a valid boundary rule", () => {
    const input: ArchDslFile = {
      version: "1",
      name: "test",
      description: "test rules",
      rules: [
        {
          id: "no-server-in-core",
          title: "core must not import server",
          suite: "boundaries",
          source: { folder: "crates/routa-core/src" },
          constraint: {
            type: "must_not_depend_on",
            target: { folder: "crates/routa-server/src" },
          },
        },
      ],
    };

    const result = validateDsl(input);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid cycle rule", () => {
    const input: ArchDslFile = {
      version: "1",
      name: "test",
      description: "test rules",
      rules: [
        {
          id: "no-cycles-core",
          title: "no cycles in core",
          suite: "cycles",
          source: { folder: "src/core" },
          constraint: { type: "no_cycles" },
        },
      ],
    };

    const result = validateDsl(input);
    expect(result.valid).toBe(true);
  });

  it("rejects wrong version", () => {
    const input = { version: "2", name: "x", description: "x", rules: [] };
    const result = validateDsl(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "version")).toBe(true);
    }
  });

  it("rejects duplicate ids", () => {
    const rule = {
      id: "dup",
      title: "dup",
      suite: "boundaries" as const,
      source: { folder: "a" },
      constraint: { type: "must_not_depend_on" as const, target: { folder: "b" } },
    };
    const input = { version: "1" as const, name: "x", description: "x", rules: [rule, rule] };
    const result = validateDsl(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("duplicate"))).toBe(true);
    }
  });

  it("rejects boundary rule missing target.folder", () => {
    const input = {
      version: "1" as const,
      name: "x",
      description: "x",
      rules: [
        {
          id: "bad",
          title: "bad rule",
          suite: "boundaries" as const,
          source: { folder: "src" },
          // constraint without target
          constraint: { type: "must_not_depend_on" as const } as ReturnType<() => never>,
        },
      ],
    };
    const result = validateDsl(input);
    expect(result.valid).toBe(false);
  });

  it("rejects null input", () => {
    const result = validateDsl(null);
    expect(result.valid).toBe(false);
  });
});

describe("loadDslFile", () => {
  it("returns validation error for non-existent file", () => {
    const result = loadDslFile("/nonexistent/path/rules.archdsl.yaml");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.field).toBe("file");
    }
  });

  it("loads and validates canonical DSL file successfully", () => {
    const result = loadDslFile(CANONICAL_DSL_PATH);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.dsl.version).toBe("1");
      expect(result.dsl.rules.length).toBeGreaterThan(0);
    }
  });
});

describe("compileDsl", () => {
  it("produces a compiled rule for a boundary rule", () => {
    const dsl: ArchDslFile = {
      version: "1",
      name: "test",
      description: "test",
      rules: [
        {
          id: "core-no-server",
          title: "Core no server",
          suite: "boundaries",
          source: { folder: "crates/routa-core/src" },
          constraint: {
            type: "must_not_depend_on",
            target: { folder: "crates/routa-server/src" },
          },
        },
      ],
    };

    const compiled = compileDsl(dsl);
    expect(compiled.rules).toHaveLength(1);
    expect(compiled.rules[0]?.archUnitDescription).toContain("must not depend on");
    expect(compiled.rules[0]?.archUnitDescription).toContain("routa-server");
  });

  it("produces a compiled rule for a cycle rule", () => {
    const dsl: ArchDslFile = {
      version: "1",
      name: "test",
      description: "test",
      rules: [
        {
          id: "no-cycles",
          title: "No cycles",
          suite: "cycles",
          source: { folder: "src/core" },
          constraint: { type: "no_cycles" },
        },
      ],
    };

    const compiled = compileDsl(dsl);
    expect(compiled.rules[0]?.archUnitDescription).toContain("no circular");
  });
});

describe("buildReport", () => {
  it("returns invalid report for missing file", () => {
    const report = buildReport("/does/not/exist.archdsl.yaml");
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("builds a valid report from the canonical DSL file", () => {
    const report: ArchDslReport = buildReport(CANONICAL_DSL_PATH);
    expect(report.valid).toBe(true);
    expect(report.name).toBe("backend-core");
    expect(report.ruleCount).toBeGreaterThan(0);
    expect(report.errors).toHaveLength(0);
  });

  it("report rules have required fields", () => {
    const report = buildReport(CANONICAL_DSL_PATH);
    if (report.valid) {
      for (const rule of report.rules) {
        expect(typeof rule.id).toBe("string");
        expect(typeof rule.title).toBe("string");
        expect(["boundaries", "cycles"]).toContain(rule.suite);
        expect(typeof rule.archUnitDescription).toBe("string");
      }
    }
  });
});
