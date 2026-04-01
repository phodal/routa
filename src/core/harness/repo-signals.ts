import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import yaml from "js-yaml";
import type {
  HarnessEntrypointGroup,
  HarnessOverviewRow,
  HarnessRepoSignalsResponse,
  HarnessScriptCategory,
  HarnessSignalsMode,
  HarnessSurfaceSignals,
} from "./repo-signals-types";

type MatchCondition = {
  fileExists?: string;
  scriptNameMatches?: string;
  scriptCommandMatches?: string;
  any?: MatchCondition[];
  all?: MatchCondition[];
};

type DerivedRule = {
  label: string;
  whenAny?: MatchCondition[];
  whenAll?: MatchCondition[];
};

type OverviewRowConfig = {
  id: string;
  label: string;
  source: "files" | "derived";
  paths?: string[];
  rules?: DerivedRule[];
  limit?: number;
};

type EntrypointGroupConfig = {
  id: string;
  label: string;
  category: HarnessScriptCategory;
  scriptNamePatterns: string[];
};

type HarnessSurfaceConfig = {
  schema: string;
  surface: HarnessSignalsMode;
  title: string;
  summary: string;
  overview: OverviewRowConfig[];
  entrypointGroups: EntrypointGroupConfig[];
};

const LOCKFILE_CANDIDATES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

function joinRepoPath(repoRoot: string, ...relativeSegments: string[]) {
  return path.join(/* turbopackIgnore: true */ repoRoot, ...relativeSegments);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compilePattern(pattern: string, warnings: string[], scope: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch (error) {
    warnings.push(`Invalid regex in ${scope}: ${pattern} (${toMessage(error)})`);
    return null;
  }
}

function matchesScriptPattern(script: { name: string; command: string }, pattern: string, warnings: string[], scope: string, field: "name" | "command") {
  const regex = compilePattern(pattern, warnings, scope);
  if (!regex) {
    return false;
  }
  return regex.test(field === "name" ? script.name : script.command);
}

function evaluateCondition(
  condition: MatchCondition,
  repoRoot: string,
  scripts: Array<{ name: string; command: string }>,
  warnings: string[],
  scope: string,
): boolean {
  const checks: boolean[] = [];

  if (condition.fileExists) {
    checks.push(fs.existsSync(path.join(repoRoot, condition.fileExists)));
  }

  if (condition.scriptNameMatches) {
    checks.push(scripts.some((script) => matchesScriptPattern(script, condition.scriptNameMatches!, warnings, scope, "name")));
  }

  if (condition.scriptCommandMatches) {
    checks.push(scripts.some((script) => matchesScriptPattern(script, condition.scriptCommandMatches!, warnings, scope, "command")));
  }

  if (condition.any) {
    checks.push(condition.any.some((child) => evaluateCondition(child, repoRoot, scripts, warnings, scope)));
  }

  if (condition.all) {
    checks.push(condition.all.every((child) => evaluateCondition(child, repoRoot, scripts, warnings, scope)));
  }

  return checks.length > 0 && checks.every(Boolean);
}

function clampItems(items: string[], limit?: number) {
  if (!limit || items.length <= limit) {
    return items;
  }
  return [...items.slice(0, limit), `+${items.length - limit} more`];
}

function buildOverviewRows(
  repoRoot: string,
  scripts: Array<{ name: string; command: string }>,
  overview: OverviewRowConfig[],
  warnings: string[],
): HarnessOverviewRow[] {
  return overview.map((row) => {
    const items = row.source === "files"
      ? (row.paths ?? []).filter((relativePath) => fs.existsSync(joinRepoPath(repoRoot, relativePath)))
      : (row.rules ?? [])
        .filter((rule) => {
          const anyPass = !rule.whenAny || rule.whenAny.some((condition) => evaluateCondition(condition, repoRoot, scripts, warnings, `${row.id}:${rule.label}`));
          const allPass = !rule.whenAll || rule.whenAll.every((condition) => evaluateCondition(condition, repoRoot, scripts, warnings, `${row.id}:${rule.label}`));
          return anyPass && allPass;
        })
        .map((rule) => rule.label);

    return {
      id: row.id,
      label: row.label,
      items: clampItems(items, row.limit),
    } satisfies HarnessOverviewRow;
  });
}

function buildEntrypointGroups(
  scripts: Array<{ name: string; command: string }>,
  groups: EntrypointGroupConfig[],
  warnings: string[],
): HarnessEntrypointGroup[] {
  return groups
    .map((group) => {
      const matchedScripts = scripts.filter((script) =>
        group.scriptNamePatterns.some((pattern) =>
          matchesScriptPattern(script, pattern, warnings, `entrypointGroup:${group.id}`, "name"),
        ),
      );

      return {
        id: group.id,
        label: group.label,
        category: group.category,
        scripts: matchedScripts.map((script) => ({
          name: script.name,
          command: script.command,
          category: group.category,
        })),
      } satisfies HarnessEntrypointGroup;
    })
    .filter((group) => group.scripts.length > 0);
}

function resolvePackageManager(packageJson: Record<string, unknown>, lockfiles: string[]): string | null {
  const raw = typeof packageJson.packageManager === "string" ? packageJson.packageManager.trim() : "";
  if (raw) {
    return raw;
  }
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("package-lock.json")) return "npm";
  if (lockfiles.includes("yarn.lock")) return "yarn";
  return null;
}

async function loadSurfaceConfig(repoRoot: string, surface: HarnessSignalsMode): Promise<HarnessSurfaceConfig> {
  const configPath = joinRepoPath(repoRoot, "docs", "harness", `${surface}.yml`);
  const raw = await fsp.readFile(configPath, "utf-8");
  const parsed = (yaml.load(raw) ?? {}) as HarnessSurfaceConfig;
  return parsed;
}

async function detectSurfaceSignals(
  repoRoot: string,
  surface: HarnessSignalsMode,
  scripts: Array<{ name: string; command: string }>,
  warnings: string[],
): Promise<HarnessSurfaceSignals> {
  const configPath = path.join("docs", "harness", `${surface}.yml`);
  const config = await loadSurfaceConfig(repoRoot, surface);

  return {
    configPath,
    title: config.title,
    summary: config.summary,
    overviewRows: buildOverviewRows(repoRoot, scripts, config.overview ?? [], warnings),
    entrypointGroups: buildEntrypointGroups(scripts, config.entrypointGroups ?? [], warnings),
  };
}

export async function detectHarnessRepoSignals(repoRoot: string): Promise<HarnessRepoSignalsResponse> {
  const warnings: string[] = [];
  const packageJsonPath = joinRepoPath(repoRoot, "package.json");
  let packageJson: Record<string, unknown> = {};

  if (fs.existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(await fsp.readFile(packageJsonPath, "utf-8")) as Record<string, unknown>;
    } catch (error) {
      warnings.push(`Failed to parse package.json: ${toMessage(error)}`);
    }
  } else {
    warnings.push("Missing package.json at repository root.");
  }

  const scripts = packageJson.scripts && typeof packageJson.scripts === "object"
    ? Object.entries(packageJson.scripts as Record<string, unknown>)
      .filter(([, command]) => typeof command === "string")
      .map(([name, command]) => ({ name, command: command as string }))
    : [];

  const lockfiles = LOCKFILE_CANDIDATES.filter((relativePath) => fs.existsSync(joinRepoPath(repoRoot, relativePath)));

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    packageManager: resolvePackageManager(packageJson, lockfiles),
    lockfiles,
    build: await detectSurfaceSignals(repoRoot, "build", scripts, warnings),
    test: await detectSurfaceSignals(repoRoot, "test", scripts, warnings),
    warnings,
  };
}
