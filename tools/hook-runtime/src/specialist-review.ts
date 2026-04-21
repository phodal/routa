import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { runCommand, tailOutput } from "./process.js";
import type { OwnershipRoutingContext } from "../../../src/core/harness/codeowners-types";

const DEFAULT_SPECIALIST_ID = "harness-review-trigger";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_ANTHROPIC_MODEL = "GLM-4.7";
const MAX_DIFF_CHARS = 40_000;
const DEFAULT_REVIEW_TIMEOUT_MS = 45_000;

type SpecialistFile = {
  id?: string;
  system_prompt?: string;
  role_reminder?: string;
  model?: string;
  default_adapter?: string;
};

export type ReviewTriggerLayer = {
  confidence_threshold?: number | null;
  specialist_id?: string | null;
  provider?: string | null;
  model?: string | null;
  context?: string[];
};

export type ReviewTrigger = {
  action: string;
  name: string;
  reasons?: string[];
  severity: string;
  confidence_threshold?: number | null;
  fallback_action?: string | null;
  specialist_id?: string | null;
  provider?: string | null;
  model?: string | null;
  context?: string[];
  review_layers?: ReviewTriggerLayer[];
};

export type ReviewReportPayload = {
  base?: string;
  triggers?: ReviewTrigger[];
  changed_files?: string[];
  committed_files?: string[];
  working_tree_files?: string[];
  untracked_files?: string[];
  ownership_routing?: OwnershipRoutingContext | null;
  diff_stats?: {
    file_count?: number;
    added_lines?: number;
    deleted_lines?: number;
  };
};

type SpecialistFinding = {
  severity?: string;
  title?: string;
  reason?: string;
  location?: string;
};

type SpecialistResponse = {
  decision?: string;
  verdict?: string;
  summary?: string;
  confidence?: number | string;
  findings?: SpecialistFinding[];
};

export type SpecialistReviewDecision = {
  allowed: boolean;
  outcome: "advisory" | "block" | "escalate" | "pass";
  summary: string;
  confidence: number | null;
  findings: SpecialistFinding[];
  raw: string;
};

export type ReviewTriggerReviewOverrides = {
  context?: string[];
  model?: string | null;
  provider?: string | null;
  specialistId?: string | null;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncate(content: string, maxChars: number): string {
  return content.length <= maxChars ? content : `${content.slice(0, maxChars)}\n\n[truncated]`;
}

function parseJsonLoose(value: string): SpecialistResponse {
  const trimmed = value.trim();
  if (!trimmed) return {};

  // Strategy 1: Try direct parse
  try {
    return JSON.parse(trimmed) as SpecialistResponse;
  } catch {
    // Continue to other strategies
  }

  // Strategy 2: Try stripping markdown code fences
  const fenceStripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(fenceStripped) as SpecialistResponse;
  } catch {
    // Continue to other strategies
  }

  // Strategy 3: Try to find ALL JSON blocks in markdown fences and use the LAST one
  // This handles cases where AI shows example format first, then real response
  const allFenceMatches = Array.from(trimmed.matchAll(/```json\s*\n?([\s\S]*?)\n?```/gi));
  if (allFenceMatches.length > 0) {
    // Try from last to first
    for (let i = allFenceMatches.length - 1; i >= 0; i--) {
      const match = allFenceMatches[i];
      if (match && match[1]) {
        try {
          return JSON.parse(match[1]) as SpecialistResponse;
        } catch {
          // Continue to next match
        }
      }
    }
  }

  // Strategy 4: Try to find the LAST valid JSON object
  // Search from end to find matching brace pairs
  for (let end = trimmed.length - 1; end >= 0; end--) {
    if (trimmed[end] === "}") {
      // Found a closing brace, now find its matching opening brace
      let depth = 1;
      for (let start = end - 1; start >= 0; start--) {
        if (trimmed[start] === "}") depth++;
        if (trimmed[start] === "{") {
          depth--;
          if (depth === 0) {
            // Found matching pair
            const candidate = trimmed.slice(start, end + 1);
            try {
              return JSON.parse(candidate) as SpecialistResponse;
            } catch {
              // This pair didn't work, continue searching
              break;
            }
          }
        }
      }
    }
  }

  // Fallback: return empty object
  return {};
}

function findSpecialistFile(rootDir: string, specialistId: string): string | null {
  const normalizedId = specialistId.trim().toLowerCase();
  if (!normalizedId) {
    return null;
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "locales") {
          continue;
        }
        stack.push(path.join(currentDir, entry.name));
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".yaml")) {
        continue;
      }

      const filePath = path.join(currentDir, entry.name);
      try {
        const parsed = (yaml.load(fs.readFileSync(filePath, "utf-8")) ?? {}) as SpecialistFile;
        if ((parsed.id ?? "").trim().toLowerCase() === normalizedId) {
          return filePath;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function loadSpecialistDefinition(specialistId: string): {
  systemPrompt: string;
  roleReminder?: string;
  model?: string;
  defaultAdapter?: string;
} {
  const rootDir = path.join(process.cwd(), "resources", "specialists");
  const filePath = findSpecialistFile(rootDir, specialistId);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Missing specialist file for ${specialistId}.`);
  }

  const parsed = (yaml.load(fs.readFileSync(filePath, "utf-8")) ?? {}) as SpecialistFile;
  if ((parsed.id ?? "").trim().toLowerCase() !== specialistId.toLowerCase()) {
    throw new Error(`Specialist file ${filePath} does not match requested specialist id ${specialistId}.`);
  }
  if (!parsed.system_prompt || !parsed.system_prompt.trim()) {
    throw new Error(`Specialist file ${filePath} is missing system_prompt.`);
  }

  return {
    systemPrompt: parsed.system_prompt,
    roleReminder: parsed.role_reminder,
    model: parsed.model,
    defaultAdapter: parsed.default_adapter,
  };
}

function resolveReviewTimeoutMs(): number {
  const raw = process.env.ROUTA_REVIEW_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_REVIEW_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REVIEW_TIMEOUT_MS;
}

async function callAnthropicCompatible(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY for automatic review specialist.");
  }

  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, "");
  const timeoutMs = resolveReviewTimeoutMs();
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Automatic review specialist failed: ${response.status} ${text}`);
  }

  const payload = JSON.parse(text) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return payload.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim() ?? "";
}

function resolveReviewProvider(defaultAdapter?: string, providerOverride?: string | null): string {
  const provider = providerOverride?.trim() || process.env.ROUTA_REVIEW_PROVIDER?.trim() || defaultAdapter?.trim() || "claude";
  return provider.toLowerCase();
}

function isClaudeProvider(provider: string): boolean {
  return ["claude", "claude-code", "claude-code-sdk", "claudecode"].includes(provider);
}

function normalizeOptionalProvider(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function resolveFallbackReviewProvider(
  primaryProvider: string,
  defaultAdapter?: string,
  providerOverride?: string | null,
): string | undefined {
  const configuredFallback = normalizeOptionalProvider(process.env.ROUTA_REVIEW_FALLBACK_PROVIDER);
  if (configuredFallback) {
    return configuredFallback === primaryProvider ? undefined : configuredFallback;
  }

  if (normalizeOptionalProvider(providerOverride)) {
    return undefined;
  }

  const explicitProvider = normalizeOptionalProvider(process.env.ROUTA_REVIEW_PROVIDER);
  if (explicitProvider) {
    return undefined;
  }

  const normalizedDefaultAdapter = normalizeOptionalProvider(defaultAdapter);
  if (normalizedDefaultAdapter && !isClaudeProvider(normalizedDefaultAdapter)) {
    return undefined;
  }

  return isClaudeProvider(primaryProvider) ? "codex" : undefined;
}

async function callClaudeCli(prompt: string): Promise<string> {
  const timeoutMs = resolveReviewTimeoutMs();
  const command = `printf '%s' ${shellQuote(prompt)} | claude -p --permission-mode bypassPermissions`;
  const result = await runCommand(command, { stream: false, timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(`Automatic review specialist failed via claude CLI: ${tailOutput(result.output) || `exit ${result.exitCode}`}`);
  }

  return result.output.trim();
}

async function callCodexCli(prompt: string): Promise<string> {
  const timeoutMs = resolveReviewTimeoutMs();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-review-codex-"));
  const outputFile = path.join(tempDir, "last-message.txt");
  const command = [
    `printf '%s' ${shellQuote(prompt)}`,
    `| codex -a never exec -s read-only -C ${shellQuote(process.cwd())}`,
    `--color never --output-last-message ${shellQuote(outputFile)} -`,
  ].join(" ");

  try {
    const result = await runCommand(command, { stream: false, timeoutMs });
    const output = fs.existsSync(outputFile)
      ? fs.readFileSync(outputFile, "utf-8")
      : result.output;
    const trimmedOutput = output.trim();
    if (trimmedOutput) {
      return trimmedOutput;
    }

    if (result.exitCode !== 0) {
      throw new Error(`Automatic review specialist failed via codex CLI: ${tailOutput(output) || `exit ${result.exitCode}`}`);
    }

    return trimmedOutput;
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

async function callReviewProviderOnce(params: {
  prompt: string;
  model: string;
  provider: string;
}): Promise<string> {
  switch (params.provider) {
    case "claude":
    case "claude-code":
    case "claude-code-sdk":
    case "claudecode":
      return callClaudeCli(params.prompt);
    case "anthropic":
    case "anthropic-api":
    case "anthropic-compatible":
      return callAnthropicCompatible(params.prompt, params.model);
    case "codex":
    case "codex-cli":
    case "openai":
    case "openai-codex":
      return callCodexCli(params.prompt);
    default:
      throw new Error(
        `Unsupported review provider "${params.provider}". Use --provider claude, --provider codex, or --provider anthropic.`,
      );
  }
}

async function callReviewProvider(params: {
  prompt: string;
  model: string;
  defaultAdapter?: string;
  providerOverride?: string | null;
  validate?: (raw: string) => boolean;
}): Promise<string> {
  const primaryProvider = resolveReviewProvider(params.defaultAdapter, params.providerOverride);
  const fallbackProvider = resolveFallbackReviewProvider(primaryProvider, params.defaultAdapter, params.providerOverride);
  const validate = params.validate;

  try {
    const raw = await callReviewProviderOnce({
      prompt: params.prompt,
      model: params.model,
      provider: primaryProvider,
    });
    if (validate && !validate(raw)) {
      throw new Error(`Automatic review specialist returned an invalid verdict: ${raw || "(empty response)"}`);
    }
    return raw;
  } catch (primaryError) {
    if (!fallbackProvider) {
      throw primaryError;
    }

    try {
      const raw = await callReviewProviderOnce({
        prompt: params.prompt,
        model: params.model,
        provider: fallbackProvider,
      });
      if (validate && !validate(raw)) {
        throw new Error(`Automatic review specialist returned an invalid verdict: ${raw || "(empty response)"}`);
      }
      return raw;
    } catch (fallbackError) {
      const primaryDetail = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Automatic review specialist failed with provider "${primaryProvider}" (${primaryDetail}) and fallback "${fallbackProvider}" (${fallbackDetail}).`,
        { cause: fallbackError },
      );
    }
  }
}

function normalizeOutcome(value: string | undefined): SpecialistReviewDecision["outcome"] | null {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "pass":
      return "pass";
    case "advisory":
      return "advisory";
    case "escalate":
    case "needs_human_review":
      return "escalate";
    case "block":
    case "fail":
      return "block";
    default:
      return null;
  }
}

function normalizeConfidence(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(10, Math.max(1, Math.round(value)));
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);
  if (Number.isFinite(parsed)) {
    return Math.min(10, Math.max(1, Math.round(parsed)));
  }

  switch (trimmed) {
    case "high":
      return 9;
    case "medium":
      return 7;
    case "low":
      return 4;
    default:
      return null;
  }
}

async function loadGraphReviewContext(reviewRoot: string, base: string): Promise<unknown | null> {
  const command = `entrix graph review-context --base ${shellQuote(base)} --json`;
  const result = await runCommand(command, { cwd: reviewRoot, stream: false });
  if (result.exitCode !== 0 || !result.output.trim()) {
    return null;
  }

  try {
    return JSON.parse(result.output);
  } catch {
    return result.output.trim();
  }
}

async function buildReviewPayload(
  reviewRoot: string,
  base: string,
  report: ReviewReportPayload,
  contextHints: string[] = [],
): Promise<string> {
  const diffRange = `${base}...HEAD`;
  const [diffStatResult, diffResult] = await Promise.all([
    runCommand(`git diff --stat ${shellQuote(diffRange)}`, { cwd: reviewRoot, stream: false }),
    runCommand(`git diff --unified=3 ${shellQuote(diffRange)}`, { cwd: reviewRoot, stream: false }),
  ]);
  const normalizedContext = contextHints
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const graphReviewContext = normalizedContext.includes("graph_review_context")
    ? await loadGraphReviewContext(reviewRoot, base)
    : null;

  return JSON.stringify({
    repoRoot: reviewRoot,
    base,
    head: "HEAD",
    triggers: report.triggers ?? [],
    changedFiles: report.changed_files ?? report.committed_files ?? [],
    committedFiles: report.committed_files ?? report.changed_files ?? [],
    workingTreeFiles: report.working_tree_files ?? [],
    untrackedFiles: report.untracked_files ?? [],
    ownershipRouting: report.ownership_routing ?? null,
    diffStats: report.diff_stats ?? {},
    diffStat: diffStatResult.output.trim(),
    diff: truncate(diffResult.output, MAX_DIFF_CHARS),
    requestedContext: normalizedContext,
    graphReviewContext,
  }, null, 2);
}

export async function runReviewTriggerSpecialist(params: {
  reviewRoot: string;
  base: string;
  report: ReviewReportPayload;
  overrides?: ReviewTriggerReviewOverrides;
}): Promise<SpecialistReviewDecision> {
  const specialistId = params.overrides?.specialistId?.trim() || DEFAULT_SPECIALIST_ID;
  const specialist = loadSpecialistDefinition(specialistId);

  const payloadJson = await buildReviewPayload(
    params.reviewRoot,
    params.base,
    params.report,
    params.overrides?.context ?? [],
  );
  let prompt = specialist.systemPrompt;
  if (specialist.roleReminder?.trim()) {
    prompt += `\n\n---\n**Reminder:** ${specialist.roleReminder.trim()}`;
  }
  prompt += `\n\n---\n\n${[
    "A review-trigger matched during pre-push. Analyze the payload and decide whether the push should pass.",
    "Return strict JSON matching the required shape.",
    "## Review Payload",
    payloadJson,
  ].join("\n\n")}`;

  const model = params.overrides?.model?.trim() || specialist.model || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const raw = await callReviewProvider({
    prompt,
    model,
    defaultAdapter: specialist.defaultAdapter,
    providerOverride: params.overrides?.provider ?? null,
    validate: (candidate) => {
      const parsed = parseJsonLoose(candidate);
      return normalizeOutcome(parsed.decision ?? parsed.verdict) !== null;
    },
  });
  const parsed = parseJsonLoose(raw);
  const outcome = normalizeOutcome(parsed.decision ?? parsed.verdict);
  const confidence = normalizeConfidence(parsed.confidence);

  if (!outcome) {
    throw new Error(`Automatic review specialist returned an invalid verdict: ${raw || "(empty response)"}`);
  }

  return {
    allowed: outcome === "pass" || outcome === "advisory",
    outcome,
    summary: parsed.summary?.trim() || (
      outcome === "pass"
        ? "Automatic review specialist approved the push."
        : outcome === "advisory"
          ? "Automatic review specialist returned advisory findings."
          : outcome === "escalate"
            ? "Automatic review specialist requested escalation."
            : "Automatic review specialist blocked the push."
    ),
    confidence,
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    raw,
  };
}
