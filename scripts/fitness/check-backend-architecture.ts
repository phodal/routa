#!/usr/bin/env node

import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isDirectExecution } from "../lib/cli";
import { fromRoot } from "../lib/paths";
import {
  defaultArchitectureDslPath,
  loadArchitectureRuleDefinitions,
} from "./architecture-rule-dsl";

type SuiteName = "boundaries" | "cycles";
type SummaryStatus = "pass" | "fail" | "skipped";

type RuleCheckOptions = {
  allowEmptyTests?: boolean;
};

type RuleCheckable = {
  check(options?: RuleCheckOptions): Promise<unknown[]>;
};

type FilesShouldCondition = {
  should(): {
    haveNoCycles(): RuleCheckable;
  };
  shouldNot(): {
    dependOnFiles(): {
      inFolder(pattern: string): RuleCheckable;
    };
  };
};

type ProjectFilesFactory = {
  inFolder(pattern: string): FilesShouldCondition;
};

type ProjectFilesFn = (tsConfigFilePath?: string) => ProjectFilesFactory;

type ArchUnitModule = {
  projectFiles: ProjectFilesFn;
};

type NormalizedViolation =
  | {
    kind: "dependency";
    source: string;
    target: string;
    edgeCount: number;
  }
  | {
    kind: "cycle";
    path: string[];
    edgeCount: number;
  }
  | {
    kind: "empty-test";
    message: string;
  }
  | {
    kind: "unknown";
    summary: string;
  };

type RuleResult = {
  id: string;
  title: string;
  suite: SuiteName;
  status: "pass" | "fail";
  violationCount: number;
  violations: NormalizedViolation[];
};

type ArchitectureReport = {
  generatedAt: string;
  repoRoot: string;
  suite: SuiteName;
  summaryStatus: SummaryStatus;
  archUnitSource: string | null;
  tsconfigPath: string;
  ruleCount: number;
  failedRuleCount: number;
  results: RuleResult[];
  notes: string[];
};

const APP_ROOT = fromRoot();

function normalizeSuite(raw: string): SuiteName {
  return raw === "cycles" ? "cycles" : "boundaries";
}

function parseSuite(argv: string[]): SuiteName {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--suite" && argv[index + 1]) {
      return normalizeSuite(argv[index + 1]);
    }
    if (arg.startsWith("--suite=")) {
      return normalizeSuite(arg.slice("--suite=".length));
    }
  }

  return "boundaries";
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseRepoRoot(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root" && argv[index + 1]) {
      return path.resolve(argv[index + 1]);
    }
    if (arg.startsWith("--repo-root=")) {
      return path.resolve(arg.slice("--repo-root=".length));
    }
  }

  const envRepoRoot = process.env.ROUTA_ARCH_REPO_ROOT?.trim();
  return envRepoRoot ? path.resolve(envRepoRoot) : null;
}

function parseDslPath(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dsl" && argv[index + 1]) {
      return argv[index + 1];
    }
    if (arg.startsWith("--dsl=")) {
      return arg.slice("--dsl=".length);
    }
  }

  const envDslPath = process.env.ROUTA_ARCH_DSL_PATH?.trim();
  return envDslPath || null;
}

function resolveArchUnitCandidates(): string[] {
  const configured = process.env.ROUTA_ARCHUNITTS_PATH?.trim();
  const candidates = [
    configured ? path.join(configured, "src", "files", "index.ts") : undefined,
    configured,
    path.join(os.homedir(), "test", "ArchUnitTS", "src", "files", "index.ts"),
    path.join(os.homedir(), "test", "ArchUnitTS", "index.ts"),
    path.join(os.homedir(), "test", "ArchUnitTS", "dist", "index.js"),
  ].filter((value): value is string => Boolean(value));

  return [...new Set(candidates)];
}

async function loadArchUnit(): Promise<{ module: ArchUnitModule; source: string } | null> {
  const nodePath = path.join(APP_ROOT, "node_modules");
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${nodePath}${path.delimiter}${process.env.NODE_PATH}`
    : nodePath;
  const moduleWithInitPaths = Module as typeof Module & { _initPaths?: () => void };
  moduleWithInitPaths._initPaths?.();

  for (const candidate of resolveArchUnitCandidates()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const imported = await import(pathToFileURL(candidate).href) as Partial<ArchUnitModule>;
      if (typeof imported.projectFiles === "function") {
        return {
          module: imported as ArchUnitModule,
          source: candidate,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeViolation(raw: unknown): NormalizedViolation {
  const record = asRecord(raw);
  if (!record) {
    return {
      kind: "unknown",
      summary: String(raw),
    };
  }

  const dependency = asRecord(record.dependency);
  if (dependency) {
    return {
      kind: "dependency",
      source: typeof dependency.sourceLabel === "string" ? dependency.sourceLabel : "unknown",
      target: typeof dependency.targetLabel === "string" ? dependency.targetLabel : "unknown",
      edgeCount: Array.isArray(dependency.cumulatedEdges) ? dependency.cumulatedEdges.length : 0,
    };
  }

  if (Array.isArray(record.cycle)) {
    const pathEntries = record.cycle
      .map((entry) => {
        const edge = asRecord(entry);
        return edge && typeof edge.sourceLabel === "string" && typeof edge.targetLabel === "string"
          ? `${edge.sourceLabel} -> ${edge.targetLabel}`
          : null;
      })
      .filter((entry): entry is string => entry !== null);

    return {
      kind: "cycle",
      path: pathEntries,
      edgeCount: record.cycle.length,
    };
  }

  if (typeof record.message === "string") {
    return {
      kind: "empty-test",
      message: record.message,
    };
  }

  return {
    kind: "unknown",
    summary: JSON.stringify(record),
  };
}

async function runSuite(suite: SuiteName): Promise<ArchitectureReport> {
  const argv = process.argv.slice(2);
  const repoRoot = parseRepoRoot(argv) ?? process.cwd();
  const requestedDslPath = parseDslPath(argv);
  const dslPath = requestedDslPath
    ? (path.isAbsolute(requestedDslPath) ? requestedDslPath : path.join(repoRoot, requestedDslPath))
    : defaultArchitectureDslPath(repoRoot);
  const tsConfigPath = path.join(repoRoot, "tsconfig.json");
  process.chdir(repoRoot);
  const notes: string[] = [];

  let dslLoad: Awaited<ReturnType<typeof loadArchitectureRuleDefinitions>>;
  try {
    dslLoad = await loadArchitectureRuleDefinitions(repoRoot, tsConfigPath, dslPath);
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      repoRoot,
      suite,
      summaryStatus: "skipped",
      archUnitSource: null,
      tsconfigPath: tsConfigPath,
      ruleCount: 0,
      failedRuleCount: 0,
      results: [],
      notes: [`Architecture DSL not available: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const archUnit = await loadArchUnit();
  if (!archUnit) {
    return {
      generatedAt: new Date().toISOString(),
      repoRoot,
      suite,
      summaryStatus: "skipped",
      archUnitSource: null,
      tsconfigPath: tsConfigPath,
      ruleCount: 0,
      failedRuleCount: 0,
      results: [],
      notes: ["ArchUnitTS source not found. Set ROUTA_ARCHUNITTS_PATH or place the local checkout at ~/test/ArchUnitTS."],
    };
  }

  const rules = dslLoad.rules.filter((rule) => rule.suite === suite);
  const results: RuleResult[] = [];

  for (const rule of rules) {
    try {
      const violations = await rule.build(archUnit.module.projectFiles).check({ allowEmptyTests: false });
      const normalizedViolations = violations.map(normalizeViolation);
      results.push({
        id: rule.id,
        title: rule.title,
        suite: rule.suite,
        status: normalizedViolations.length > 0 ? "fail" : "pass",
        violationCount: normalizedViolations.length,
        violations: normalizedViolations,
      });
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      notes.push(`Rule execution failed for ${rule.id}: ${summary}`);
      results.push({
        id: rule.id,
        title: rule.title,
        suite: rule.suite,
        status: "fail",
        violationCount: 1,
        violations: [
          {
            kind: "unknown",
            summary,
          },
        ],
      });
    }
  }

  const failedRuleCount = results.filter((result) => result.status === "fail").length;

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    suite,
    summaryStatus: failedRuleCount > 0 ? "fail" : "pass",
    archUnitSource: archUnit.source,
    tsconfigPath: tsConfigPath,
    ruleCount: results.length,
    failedRuleCount,
    results,
    notes,
  };
}

function printHumanReport(report: ArchitectureReport) {
  console.log(`Architecture suite: ${report.suite}`);
  console.log(`Summary status: ${report.summaryStatus}`);
  if (report.archUnitSource) {
    console.log(`ArchUnitTS source: ${report.archUnitSource}`);
  }

  for (const note of report.notes) {
    console.log(`Note: ${note}`);
  }

  for (const result of report.results) {
    console.log(`${result.status === "pass" ? "PASS" : "FAIL"} ${result.id} (${result.violationCount})`);
    for (const violation of result.violations.slice(0, 5)) {
      if (violation.kind === "dependency") {
        console.log(`  - ${violation.source} -> ${violation.target} (${violation.edgeCount})`);
      } else if (violation.kind === "cycle") {
        console.log(`  - cycle: ${violation.path.join(" | ")}`);
      } else if (violation.kind === "empty-test") {
        console.log(`  - ${violation.message}`);
      } else {
        console.log(`  - ${violation.summary}`);
      }
    }
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const suite = parseSuite(argv);
  const report = await runSuite(suite);

  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  return report.summaryStatus === "fail" ? 1 : 0;
}

if (isDirectExecution(import.meta.url)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
