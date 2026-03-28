import * as fs from "fs";
import { promises as fsp } from "fs";
import matter from "gray-matter";
import yaml from "js-yaml";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

type HarnessContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

type HookProfileName = "pre-push" | "pre-commit" | "local-validate";
type RuntimePhase = "submodule" | "fitness" | "fitness-fast" | "review";

type HookMetricSummary = {
  name: string;
  command: string;
  description: string;
  hardGate: boolean;
  resolved: boolean;
  sourceFile?: string;
};

type HookRuntimeProfileSummary = {
  name: HookProfileName;
  phases: RuntimePhase[];
  fallbackMetrics: string[];
  metrics: HookMetricSummary[];
  hooks: string[];
};

type HookFileSummary = {
  name: string;
  relativePath: string;
  source: string;
  triggerCommand: string;
  kind: "runtime-profile" | "shell-command";
  runtimeProfileName?: HookProfileName;
  skipEnvVar?: string;
};

type HooksResponse = {
  generatedAt: string;
  repoRoot: string;
  hooksDir: string;
  hookFiles: HookFileSummary[];
  profiles: HookRuntimeProfileSummary[];
  warnings: string[];
};

type FitnessManifest = {
  evidence_files?: string[];
};

type FrontmatterMetric = {
  command?: string;
  description?: string;
  hard_gate?: boolean;
  name?: string;
};

const DEFAULT_PROFILE_METRICS: Record<HookProfileName, readonly string[]> = {
  "pre-push": ["eslint_pass", "ts_typecheck_pass", "ts_test_pass", "clippy_pass", "rust_test_pass"],
  "pre-commit": ["eslint_pass"],
  "local-validate": ["eslint_pass", "ts_typecheck_pass", "ts_test_pass", "clippy_pass", "rust_test_pass"],
};

const DEFAULT_RUNTIME_PROFILES: Record<HookProfileName, RuntimePhase[]> = {
  "pre-push": ["submodule", "fitness", "review"],
  "pre-commit": ["fitness-fast"],
  "local-validate": ["fitness", "review"],
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeContextValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseContext(searchParams: URLSearchParams): HarnessContext {
  return {
    workspaceId: normalizeContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeContextValue(searchParams.get("repoPath")),
  };
}

function isRoutaRepoRoot(repoRoot: string): boolean {
  return (
    fs.existsSync(path.join(repoRoot, "docs", "fitness", "harness-fluency.model.yaml"))
    && fs.existsSync(path.join(repoRoot, "crates", "routa-cli"))
  );
}

async function resolveRepoRoot(context: HarnessContext): Promise<string> {
  const workspaceId = normalizeContextValue(context.workspaceId);
  const codebaseId = normalizeContextValue(context.codebaseId);
  const repoPath = normalizeContextValue(context.repoPath);
  const system = getRoutaSystem();

  const directPath = repoPath ? path.resolve(repoPath) : undefined;
  if (directPath) {
    if (!fs.existsSync(directPath) || !fs.statSync(directPath).isDirectory()) {
      throw new Error(`repoPath 不存在或不是目录: ${directPath}`);
    }
    if (!isRoutaRepoRoot(directPath)) {
      throw new Error(`repoPath 不是 Routa 仓库: ${directPath}`);
    }
    return directPath;
  }

  if (codebaseId) {
    const codebase = await system.codebaseStore.get(codebaseId);
    if (!codebase) {
      throw new Error(`Codebase 未找到: ${codebaseId}`);
    }

    const candidate = path.resolve(codebase.repoPath);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`Codebase 的路径不存在或不是目录: ${candidate}`);
    }
    if (!isRoutaRepoRoot(candidate)) {
      throw new Error(`Codebase 的路径不是 Routa 仓库: ${candidate}`);
    }
    return candidate;
  }

  if (!workspaceId) {
    throw new Error("缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一");
  }

  const codebases = await system.codebaseStore.listByWorkspace(workspaceId);
  if (codebases.length === 0) {
    throw new Error(`Workspace 下没有配置 codebase: ${workspaceId}`);
  }

  const fallback = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
  const candidate = path.resolve(fallback.repoPath);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`默认 codebase 的路径不存在或不是目录: ${candidate}`);
  }
  if (!isRoutaRepoRoot(candidate)) {
    throw new Error(`默认 codebase 的路径不是 Routa 仓库: ${candidate}`);
  }
  return candidate;
}

function isContextError(message: string) {
  return message.includes("缺少 harness 上下文")
    || message.includes("Codebase 未找到")
    || message.includes("Codebase 的路径")
    || message.includes("repoPath")
    || message.includes("Workspace 下没有配置 codebase")
    || message.includes("不是 Routa 仓库")
    || message.includes("不存在或不是目录");
}

function detectRuntimeProfile(hookName: string, source: string): HookProfileName | undefined {
  const explicitMatch = source.match(/--profile(?:=|\s+)(pre-push|pre-commit|local-validate)\b/u);
  if (explicitMatch?.[1]) {
    return explicitMatch[1] as HookProfileName;
  }
  if (hookName === "pre-push" || hookName === "pre-commit") {
    return hookName;
  }
  return undefined;
}

function extractTriggerCommand(source: string): string {
  const runtimeLine = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("tools/hook-runtime/src/cli.ts"));
  if (runtimeLine) {
    return runtimeLine;
  }

  const commandLines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return commandLines.at(-1) ?? "(no command detected)";
}

async function loadMetricLookup(repoRoot: string): Promise<{
  metrics: Map<string, Omit<HookMetricSummary, "resolved">>;
  warnings: string[];
}> {
  const metrics = new Map<string, Omit<HookMetricSummary, "resolved">>();
  const warnings: string[] = [];
  const manifestPath = path.join(repoRoot, "docs", "fitness", "manifest.yaml");

  if (!fs.existsSync(manifestPath)) {
    warnings.push('Missing docs/fitness/manifest.yaml, so hook metrics could not be resolved.');
    return { metrics, warnings };
  }

  try {
    const rawManifest = await fsp.readFile(manifestPath, "utf-8");
    const manifest = (yaml.load(rawManifest) ?? {}) as FitnessManifest;
    const evidenceFiles = Array.isArray(manifest.evidence_files) ? manifest.evidence_files : [];

    for (const relativeFile of evidenceFiles) {
      const absoluteFile = path.join(repoRoot, relativeFile);
      if (!fs.existsSync(absoluteFile)) {
        warnings.push(`Missing metric source file: ${relativeFile}`);
        continue;
      }

      const raw = await fsp.readFile(absoluteFile, "utf-8");
      const parsed = matter(raw);
      const frontmatterMetrics = Array.isArray(parsed.data.metrics) ? parsed.data.metrics : [];

      for (const entry of frontmatterMetrics as FrontmatterMetric[]) {
        if (!entry?.name || !entry.command) {
          continue;
        }
        metrics.set(entry.name, {
          name: entry.name,
          command: entry.command,
          description: entry.description ?? "",
          hardGate: Boolean(entry.hard_gate),
          sourceFile: relativeFile,
        });
      }
    }
  } catch (error) {
    warnings.push(`Failed to read hook metric manifest: ${toMessage(error)}`);
  }

  return { metrics, warnings };
}

function buildProfileSummaries(
  hookFiles: HookFileSummary[],
  metricLookup: Map<string, Omit<HookMetricSummary, "resolved">>,
): HookRuntimeProfileSummary[] {
  return (Object.keys(DEFAULT_RUNTIME_PROFILES) as HookProfileName[]).map((profileName) => {
    const fallbackMetrics = [...DEFAULT_PROFILE_METRICS[profileName]];
    return {
      name: profileName,
      phases: [...DEFAULT_RUNTIME_PROFILES[profileName]],
      fallbackMetrics,
      hooks: hookFiles
        .filter((hook) => hook.runtimeProfileName === profileName)
        .map((hook) => hook.name),
      metrics: fallbackMetrics.map((metricName) => {
        const metric = metricLookup.get(metricName);
        return metric
          ? { ...metric, resolved: true }
          : {
            name: metricName,
            command: "",
            description: "",
            hardGate: false,
            resolved: false,
          };
      }),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const hooksDir = path.join(repoRoot, ".husky");
    const warnings: string[] = [];

    if (!fs.existsSync(hooksDir) || !fs.statSync(hooksDir).isDirectory()) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        repoRoot,
        hooksDir,
        hookFiles: [],
        profiles: buildProfileSummaries([], new Map()),
        warnings: ['No ".husky" directory found for this repository.'],
      } satisfies HooksResponse);
    }

    const entries = await fsp.readdir(hooksDir, { withFileTypes: true });
    const hookFiles: HookFileSummary[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || entry.name.startsWith("_")) {
        continue;
      }

      const relativePath = path.posix.join(".husky", entry.name);
      const fullPath = path.join(hooksDir, entry.name);
      const source = await fsp.readFile(fullPath, "utf-8");
      const runtimeProfileName = source.includes("tools/hook-runtime/src/cli.ts")
        ? detectRuntimeProfile(entry.name, source)
        : undefined;

      hookFiles.push({
        name: entry.name,
        relativePath,
        source,
        triggerCommand: extractTriggerCommand(source),
        kind: runtimeProfileName ? "runtime-profile" : "shell-command",
        runtimeProfileName,
        skipEnvVar: source.includes("SKIP_HOOKS") ? "SKIP_HOOKS" : undefined,
      });
    }

    const metricLookup = await loadMetricLookup(repoRoot);
    warnings.push(...metricLookup.warnings);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot,
      hooksDir,
      hookFiles,
      profiles: buildProfileSummaries(hookFiles, metricLookup.metrics),
      warnings,
    } satisfies HooksResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Harness hooks 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 Hook Runtime 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
