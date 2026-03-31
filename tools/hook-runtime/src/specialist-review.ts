import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { runCommand, tailOutput } from "./process.js";

const DEFAULT_SPECIALIST_ID = "harness-review-trigger";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_ANTHROPIC_MODEL = "GLM-4.7";
const MAX_DIFF_CHARS = 40_000;

type SpecialistFile = {
  id?: string;
  system_prompt?: string;
  role_reminder?: string;
  model?: string;
  default_adapter?: string;
};

export type ReviewTrigger = {
  action: string;
  name: string;
  reasons?: string[];
  severity: string;
};

export type ReviewReportPayload = {
  base?: string;
  triggers?: ReviewTrigger[];
  changed_files?: string[];
  committed_files?: string[];
  working_tree_files?: string[];
  untracked_files?: string[];
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
  verdict?: string;
  summary?: string;
  confidence?: string;
  findings?: SpecialistFinding[];
};

export type SpecialistReviewDecision = {
  allowed: boolean;
  summary: string;
  confidence?: string;
  findings: SpecialistFinding[];
  raw: string;
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

  try {
    return JSON.parse(trimmed) as SpecialistResponse;
  } catch {
    const fenceStripped = trimmed
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      return JSON.parse(fenceStripped) as SpecialistResponse;
    } catch {
      return {};
    }
  }
}

function loadSpecialistDefinition(specialistId: string): {
  systemPrompt: string;
  roleReminder?: string;
  model?: string;
  defaultAdapter?: string;
} {
  const filePath = path.join(process.cwd(), "resources", "specialists", "harness", "review-trigger-guard.yaml");
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing specialist file for ${specialistId}: ${filePath}`);
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

async function callAnthropicCompatible(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY for automatic review specialist.");
  }

  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
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

function resolveReviewProvider(defaultAdapter?: string): string {
  const provider = process.env.ROUTA_REVIEW_PROVIDER?.trim() || defaultAdapter?.trim() || "claude";
  return provider.toLowerCase();
}

async function callClaudeCli(prompt: string): Promise<string> {
  const command = `printf '%s' ${shellQuote(prompt)} | claude -p --permission-mode bypassPermissions`;
  const result = await runCommand(command, { stream: false });
  if (result.exitCode !== 0) {
    throw new Error(`Automatic review specialist failed via claude CLI: ${tailOutput(result.output) || `exit ${result.exitCode}`}`);
  }

  return result.output.trim();
}

async function callReviewProvider(params: {
  prompt: string;
  model: string;
  defaultAdapter?: string;
}): Promise<string> {
  const provider = resolveReviewProvider(params.defaultAdapter);
  switch (provider) {
    case "claude":
    case "claude-code":
    case "claude-code-sdk":
    case "claudecode":
      return callClaudeCli(params.prompt);
    case "anthropic":
    case "anthropic-api":
    case "anthropic-compatible":
      return callAnthropicCompatible(params.prompt, params.model);
    default:
      throw new Error(
        `Unsupported review provider "${provider}". Use --provider claude for Claude CLI or --provider anthropic for direct API calls.`,
      );
  }
}

async function buildReviewPayload(reviewRoot: string, base: string, report: ReviewReportPayload): Promise<string> {
  const diffRange = `${base}...HEAD`;
  const [diffStatResult, diffResult] = await Promise.all([
    runCommand(`git diff --stat ${shellQuote(diffRange)}`, { cwd: reviewRoot, stream: false }),
    runCommand(`git diff --unified=3 ${shellQuote(diffRange)}`, { cwd: reviewRoot, stream: false }),
  ]);

  return JSON.stringify({
    repoRoot: reviewRoot,
    base,
    head: "HEAD",
    triggers: report.triggers ?? [],
    changedFiles: report.changed_files ?? report.committed_files ?? [],
    committedFiles: report.committed_files ?? report.changed_files ?? [],
    workingTreeFiles: report.working_tree_files ?? [],
    untrackedFiles: report.untracked_files ?? [],
    diffStats: report.diff_stats ?? {},
    diffStat: diffStatResult.output.trim(),
    diff: truncate(diffResult.output, MAX_DIFF_CHARS),
  }, null, 2);
}

export async function runReviewTriggerSpecialist(params: {
  reviewRoot: string;
  base: string;
  report: ReviewReportPayload;
  specialistId?: string;
}): Promise<SpecialistReviewDecision> {
  const specialistId = params.specialistId ?? DEFAULT_SPECIALIST_ID;
  const specialist = loadSpecialistDefinition(specialistId);

  const payloadJson = await buildReviewPayload(params.reviewRoot, params.base, params.report);
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

  const model = specialist.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const raw = await callReviewProvider({
    prompt,
    model,
    defaultAdapter: specialist.defaultAdapter,
  });
  const parsed = parseJsonLoose(raw);
  const verdict = parsed.verdict?.toLowerCase();

  if (verdict !== "pass" && verdict !== "fail") {
    throw new Error(`Automatic review specialist returned an invalid verdict: ${raw || "(empty response)"}`);
  }

  return {
    allowed: verdict === "pass",
    summary: parsed.summary?.trim() || (verdict === "pass" ? "Automatic review specialist approved the push." : "Automatic review specialist blocked the push."),
    confidence: parsed.confidence,
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    raw,
  };
}
