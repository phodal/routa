import { promises as fsp } from "fs";
import * as fs from "fs";
import yaml from "js-yaml";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  parseContext,
  resolveRepoRoot,
  isContextError,
} from "../hooks/shared";

/* ── All known agent-hook events across Claude Code, Qoder, Codex ── */
const KNOWN_EVENTS = new Set([
  /* Session */
  "SessionStart", "SessionEnd", "Setup",
  /* Prompt */
  "UserPromptSubmit",
  /* Tool */
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest",
  /* Agent */
  "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted",
  /* Context */
  "PreCompact", "PostCompact", "InstructionsLoaded", "ConfigChange",
  /* File / Dir */
  "CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove",
  /* Completion */
  "Stop", "StopFailure", "Notification", "TeammateIdle",
  /* Elicitation */
  "Elicitation", "ElicitationResult",
]);

const BLOCKABLE_EVENTS = new Set([
  "PreToolUse",
  "UserPromptSubmit",
  "PermissionRequest",
]);

const KNOWN_TYPES = new Set(["command", "http", "prompt", "agent"]);

type AgentHookConfigSummary = {
  event: string;
  matcher?: string;
  type: string;
  command?: string;
  url?: string;
  prompt?: string;
  timeout: number;
  blocking: boolean;
  description?: string;
  source?: string;
};

type AgentHooksResponse = {
  generatedAt: string;
  repoRoot: string;
  configFile: {
    relativePath: string;
    source: string;
    schema?: string;
  } | null;
  configFiles: Array<{
    relativePath: string;
    source: string;
    schema?: string;
    provider?: string;
  }>;
  hooks: AgentHookConfigSummary[];
  warnings: string[];
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTimeout(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 10;
}

function normalizeBlocking(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

/* ── Standard hook config providers (Claude Code, Qoder, Codex) ── */

type StandardHookEntry = {
  type?: string;
  command?: string;
  url?: string;
  prompt?: string;
  timeout?: number;
  if?: string;
  statusMessage?: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  model?: string;
};

type StandardHookGroup = {
  matcher?: string;
  hooks?: StandardHookEntry[];
};

type StandardHooksConfig = {
  hooks?: Record<string, StandardHookGroup[]>;
};

type ConfigFileInfo = {
  relativePath: string;
  source: string;
  schema?: string;
  provider?: string;
};

const STANDARD_CONFIG_LOCATIONS: Array<{ relativePath: string; provider: string }> = [
  { relativePath: ".claude/settings.json", provider: "claude-code" },
  { relativePath: ".claude/settings.local.json", provider: "claude-code" },
  { relativePath: ".qoder/settings.json", provider: "qoder" },
  { relativePath: ".qoder/settings.local.json", provider: "qoder" },
  { relativePath: ".codex/hooks.json", provider: "codex" },
];

function parseStandardHooksConfig(
  raw: string,
  relativePath: string,
  provider: string,
  warnings: string[],
): { hooks: AgentHookConfigSummary[]; configFile: ConfigFileInfo } {
  const hooks: AgentHookConfigSummary[] = [];

  let parsed: StandardHooksConfig;
  try {
    parsed = JSON.parse(raw) as StandardHooksConfig;
  } catch {
    warnings.push(`Failed to parse ${relativePath} as JSON.`);
    return { hooks, configFile: { relativePath, source: raw, provider } };
  }

  const hooksMap = parsed.hooks;
  if (!hooksMap || typeof hooksMap !== "object") {
    return { hooks, configFile: { relativePath, source: raw, provider } };
  }

  for (const [eventName, groups] of Object.entries(hooksMap)) {
    if (!Array.isArray(groups)) continue;

    for (const group of groups) {
      if (!group || typeof group !== "object") continue;
      const matcher = typeof group.matcher === "string" && group.matcher.trim().length > 0
        ? group.matcher.trim()
        : undefined;

      const hookEntries = Array.isArray(group.hooks) ? group.hooks : [];
      for (const entry of hookEntries) {
        if (!entry || typeof entry !== "object") continue;

        const hookType = typeof entry.type === "string" ? entry.type.trim() : "command";
        const blocking = BLOCKABLE_EVENTS.has(eventName);

        hooks.push({
          event: eventName,
          matcher,
          type: hookType,
          command: typeof entry.command === "string" ? entry.command : undefined,
          url: typeof entry.url === "string" ? entry.url : undefined,
          prompt: typeof entry.prompt === "string" ? entry.prompt : undefined,
          timeout: normalizeTimeout(entry.timeout),
          blocking,
          source: `${provider}:${relativePath}`,
        });
      }
    }
  }

  return { hooks, configFile: { relativePath, source: raw, provider } };
}

/* ── Custom YAML format (routa-specific agent-hooks.yaml) ── */

type AgentHookConfigRaw = {
  event?: string;
  matcher?: string;
  type?: string;
  command?: string;
  url?: string;
  prompt?: string;
  timeout?: unknown;
  blocking?: unknown;
  description?: string;
};

type AgentHookConfigFile = {
  schema?: string;
  hooks?: AgentHookConfigRaw[];
};

function parseCustomYamlConfig(
  rawSource: string,
  warnings: string[],
): { hooks: AgentHookConfigSummary[]; configFile: ConfigFileInfo } {
  const hooks: AgentHookConfigSummary[] = [];

  let parsed: AgentHookConfigFile;
  try {
    parsed = (yaml.load(rawSource) ?? {}) as AgentHookConfigFile;
  } catch (parseError) {
    warnings.push(`Invalid YAML in agent-hooks.yaml: ${toMessage(parseError)}`);
    return {
      hooks,
      configFile: {
        relativePath: "docs/fitness/runtime/agent-hooks.yaml",
        source: rawSource,
        provider: "routa",
      },
    };
  }

  const rawHooks = Array.isArray(parsed.hooks) ? parsed.hooks : [];
  for (const raw of rawHooks) {
    const event = typeof raw.event === "string" ? raw.event.trim() : "";
    if (!event) {
      warnings.push("Skipped hook entry with missing event field.");
      continue;
    }
    if (!KNOWN_EVENTS.has(event)) {
      warnings.push(`Unknown agent hook event: "${event}".`);
      continue;
    }

    const hookType = typeof raw.type === "string" ? raw.type.trim() : "command";
    if (!KNOWN_TYPES.has(hookType)) {
      warnings.push(`Unknown hook type "${hookType}" for event "${event}".`);
      continue;
    }

    const blocking = normalizeBlocking(raw.blocking);
    if (blocking && !BLOCKABLE_EVENTS.has(event)) {
      warnings.push(`Event "${event}" does not support blocking. Setting blocking to false.`);
    }
    const effectiveBlocking = blocking && BLOCKABLE_EVENTS.has(event);

    hooks.push({
      event,
      matcher: typeof raw.matcher === "string" && raw.matcher.trim().length > 0 ? raw.matcher.trim() : undefined,
      type: hookType,
      command: typeof raw.command === "string" ? raw.command : undefined,
      url: typeof raw.url === "string" ? raw.url : undefined,
      prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
      timeout: normalizeTimeout(raw.timeout),
      blocking: effectiveBlocking,
      description: typeof raw.description === "string" ? raw.description : undefined,
      source: "routa:docs/fitness/runtime/agent-hooks.yaml",
    });
  }

  return {
    hooks,
    configFile: {
      relativePath: "docs/fitness/runtime/agent-hooks.yaml",
      source: rawSource,
      schema: typeof parsed.schema === "string" ? parsed.schema : undefined,
      provider: "routa",
    },
  };
}

export async function GET(request: NextRequest) {
  const context = parseContext(request.nextUrl.searchParams);
  let repoRoot: string;
  try {
    repoRoot = await resolveRepoRoot(context);
  } catch (resolveError) {
    const message = toMessage(resolveError);
    const status = isContextError(message) ? 400 : 500;
    return NextResponse.json({ error: "resolve_failed", details: message }, { status });
  }

  const warnings: string[] = [];
  const allHooks: AgentHookConfigSummary[] = [];
  const configFiles: ConfigFileInfo[] = [];

  /* 1. Scan standard hook config files (Claude Code, Qoder, Codex) */
  for (const { relativePath, provider } of STANDARD_CONFIG_LOCATIONS) {
    const fullPath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const raw = await fsp.readFile(fullPath, "utf-8");
      const result = parseStandardHooksConfig(raw, relativePath, provider, warnings);
      allHooks.push(...result.hooks);
      if (result.hooks.length > 0 || result.configFile) {
        configFiles.push(result.configFile);
      }
    } catch {
      warnings.push(`Failed to read ${relativePath}.`);
    }
  }

  /* 2. Scan custom YAML config (routa-specific) */
  const yamlPath = path.join(repoRoot, "docs", "fitness", "runtime", "agent-hooks.yaml");
  if (fs.existsSync(yamlPath)) {
    try {
      const rawSource = await fsp.readFile(yamlPath, "utf-8");
      const result = parseCustomYamlConfig(rawSource, warnings);
      allHooks.push(...result.hooks);
      configFiles.push(result.configFile);
    } catch {
      warnings.push("Failed to read docs/fitness/runtime/agent-hooks.yaml.");
    }
  }

  if (allHooks.length === 0 && configFiles.length === 0) {
    warnings.push("No agent hook configuration found. Checked: " +
      STANDARD_CONFIG_LOCATIONS.map((l) => l.relativePath).join(", ") +
      ", docs/fitness/runtime/agent-hooks.yaml");
  }

  const primaryConfigFile = configFiles[0] ?? null;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    repoRoot,
    configFile: primaryConfigFile ? {
      relativePath: primaryConfigFile.relativePath,
      source: primaryConfigFile.source,
      schema: primaryConfigFile.schema,
    } : null,
    configFiles,
    hooks: allHooks,
    warnings,
  } satisfies AgentHooksResponse);
}
