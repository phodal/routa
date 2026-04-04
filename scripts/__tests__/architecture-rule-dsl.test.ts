import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  compileArchitectureDslDocument,
  loadArchitectureDslFile,
  parseArchitectureDslSource,
} from "../fitness/architecture-rule-dsl";

function createFakeProjectFiles(log: string[]) {
  return (tsConfigPath?: string) => ({
    inFolder(pattern: string) {
      log.push(`projectFiles:${tsConfigPath ?? ""}`);
      log.push(`inFolder:${pattern}`);
      return {
        shouldNot() {
          log.push("shouldNot");
          return {
            dependOnFiles() {
              log.push("dependOnFiles");
              return {
                inFolder(targetPattern: string) {
                  log.push(`target:${targetPattern}`);
                  return {
                    check: vi.fn(async () => []),
                  };
                },
              };
            },
          };
        },
        should() {
          log.push("should");
          return {
            haveNoCycles() {
              log.push("haveNoCycles");
              return {
                check: vi.fn(async () => []),
              };
            },
          };
        },
      };
    },
  });
}

describe("architecture rule DSL", () => {
  it("loads the canonical backend core DSL file", async () => {
    const filePath = path.join(process.cwd(), "architecture", "rules", "backend-core.archdsl.yaml");
    const loaded = await loadArchitectureDslFile(filePath);

    expect(loaded.document.schema).toBe("routa.archdsl/v1");
    expect(loaded.document.model.id).toBe("backend_core");
    expect(Object.keys(loaded.document.selectors)).toEqual([
      "core_ts",
      "app_ts",
      "api_ts",
      "client_ts",
    ]);
    expect(loaded.document.rules).toHaveLength(4);
    expect(loaded.document.rules[0]).toMatchObject({
      id: "ts_backend_core_no_core_to_app",
      kind: "dependency",
      suite: "boundaries",
    });
  });

  it("compiles architecture rules into ArchUnitTS builders", () => {
    const document = parseArchitectureDslSource(`
schema: routa.archdsl/v1
model:
  id: demo
  title: Demo
selectors:
  core_ts:
    kind: files
    language: typescript
    include:
      - src/core/**
  app_ts:
    kind: files
    language: typescript
    include:
      - src/app/**
rules:
  - id: no_core_to_app
    title: no core to app
    kind: dependency
    suite: boundaries
    severity: advisory
    from: core_ts
    relation: must_not_depend_on
    to: app_ts
    engine_hints:
      - archunitts
  - id: no_cycles
    title: no cycles
    kind: cycle
    suite: cycles
    severity: advisory
    scope: core_ts
    relation: must_be_acyclic
    engine_hints:
      - archunitts
`);

    const log: string[] = [];
    const fakeProjectFiles = createFakeProjectFiles(log);
    const compiled = compileArchitectureDslDocument(document, "/repo/tsconfig.json");

    expect(compiled).toHaveLength(2);

    const dependencyResult = compiled[0].build(fakeProjectFiles);
    expect(dependencyResult).toHaveProperty("check");
    expect(log).toEqual([
      "projectFiles:/repo/tsconfig.json",
      "inFolder:src/core/**",
      "shouldNot",
      "dependOnFiles",
      "target:src/app/**",
    ]);

    log.length = 0;
    const cycleResult = compiled[1].build(fakeProjectFiles);
    expect(cycleResult).toHaveProperty("check");
    expect(log).toEqual([
      "projectFiles:/repo/tsconfig.json",
      "inFolder:src/core/**",
      "should",
      "haveNoCycles",
    ]);
  });

  it("rejects rules that reference unknown selectors", () => {
    expect(() => parseArchitectureDslSource(`
schema: routa.archdsl/v1
model:
  id: demo
  title: Demo
selectors:
  core_ts:
    kind: files
    language: typescript
    include:
      - src/core/**
rules:
  - id: no_core_to_app
    title: no core to app
    kind: dependency
    suite: boundaries
    severity: advisory
    from: core_ts
    relation: must_not_depend_on
    to: app_ts
`)).toThrow(/Unknown selector referenced/);
  });
});
