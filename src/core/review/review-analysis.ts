import * as fs from "fs";
import * as path from "path";

import { getSpecialistById, buildSpecialistFirstPrompt } from "../orchestration/specialist-prompts";
import { gitExec, safeExecSync } from "../utils/safe-exec";
import {
  buildHistoricalRelatedFiles,
  type HistoricalRelatedFile,
} from "./historical-related-files";
import { buildReviewWorkerPrompt, type ReviewWorkerType } from "./review-worker-prompts";

const CONFIG_CANDIDATES = [
  "AGENTS.md",
  "package.json",
  "tsconfig.json",
  "eslint.config.mjs",
  "next.config.ts",
  "Cargo.toml",
  ".routa/review-rules.md",
] as const;

export interface ReviewAnalyzeOptions {
  repoPath?: string;
  base?: string;
  head?: string;
  rulesFile?: string;
  model?: string;
  validatorModel?: string;
}

export interface ReviewAnalysisPayload {
  repoPath: string;
  repoRoot: string;
  base: string;
  head: string;
  changedFiles: string[];
  diffStat: string;
  diff: string;
  configSnippets: Array<{ path: string; content: string }>;
  reviewRules?: string;
  graphReviewContext?: unknown;
  historicalRelatedFiles?: HistoricalRelatedFile[];
}

export interface ReviewAnalysisResult {
  payload: ReviewAnalysisPayload;
  context: unknown;
  candidates: unknown;
  validated: unknown;
  raw: {
    context: string;
    candidates: string;
    validated: string;
  };
}

export async function analyzeReview(options: ReviewAnalyzeOptions = {}): Promise<ReviewAnalysisResult> {
  const payload = buildReviewAnalysisPayload(options);

  const contextRaw = await runReviewSpecialist({
    specialistId: "pr-reviewer",
    workerType: "context",
    userRequest: buildReviewWorkerPrompt({ workerType: "context", payload }),
    modelOverride: options.model,
  });

  const candidatesRaw = await runReviewSpecialist({
    specialistId: "pr-reviewer",
    workerType: "candidates",
    userRequest: buildReviewWorkerPrompt({ workerType: "candidates", payload, contextRaw }),
    modelOverride: options.model,
  });

  const validatedRaw = await runReviewSpecialist({
    specialistId: "pr-reviewer",
    workerType: "validator",
    userRequest: buildReviewWorkerPrompt({ workerType: "validator", payload, contextRaw, candidatesRaw }),
    modelOverride: options.validatorModel ?? options.model,
  });

  return {
    payload,
    context: parseJsonLoose(contextRaw),
    candidates: parseJsonLoose(candidatesRaw),
    validated: parseJsonLoose(validatedRaw),
    raw: {
      context: contextRaw,
      candidates: candidatesRaw,
      validated: validatedRaw,
    },
  };
}

export function buildReviewAnalysisPayload(options: ReviewAnalyzeOptions = {}): ReviewAnalysisPayload {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const base = options.base ?? "HEAD~1";
  const head = options.head ?? "HEAD";
  const diffRange = `${base}..${head}`;
  const changedFiles = gitExec(["diff", "--name-only", diffRange], { cwd: repoRoot })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    repoPath: repoRoot,
    repoRoot,
    base,
    head,
    changedFiles,
    diffStat: gitExec(["diff", "--stat", diffRange], { cwd: repoRoot }).trim(),
    diff: truncate(gitExec(["diff", "--unified=3", diffRange], { cwd: repoRoot }), 40_000),
    configSnippets: loadConfigSnippets(repoRoot),
    reviewRules: loadReviewRules(repoRoot, options.rulesFile),
    graphReviewContext: loadGraphReviewContext(repoRoot, base),
    historicalRelatedFiles: buildHistoricalRelatedFiles({
      repoRoot,
      diffRange,
      head,
      changedFiles,
    }),
  };
}

function resolveRepoRoot(repoPath?: string): string {
  const cwd = repoPath ?? process.cwd();
  return gitExec(["rev-parse", "--show-toplevel"], { cwd }).trim();
}

function loadConfigSnippets(repoRoot: string): Array<{ path: string; content: string }> {
  return CONFIG_CANDIDATES.flatMap((relativePath) => {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath)) return [];
    return [{
      path: relativePath,
      content: truncate(fs.readFileSync(filePath, "utf-8"), 4_000),
    }];
  });
}

function loadReviewRules(repoRoot: string, rulesFile?: string): string | undefined {
  const targetPath = rulesFile ? path.resolve(rulesFile) : path.join(repoRoot, ".routa", "review-rules.md");
  if (!fs.existsSync(targetPath)) return undefined;
  return truncate(fs.readFileSync(targetPath, "utf-8"), 8_000);
}

function loadGraphReviewContext(repoRoot: string, base: string): unknown {
  try {
    const raw = safeExecSync("entrix", ["graph", "review-context", "--base", base, "--json"], { cwd: repoRoot });
    const parsed = parseJsonLoose(raw);
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}

async function runReviewSpecialist(params: {
  specialistId: string;
  workerType: ReviewWorkerType;
  userRequest: string;
  modelOverride?: string;
}): Promise<string> {
  const specialist = getSpecialistById(params.specialistId);
  if (!specialist) {
    throw new Error(`Unknown specialist: ${params.specialistId}`);
  }

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY is required for review analysis.");
  }

  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const model = params.modelOverride || process.env.ANTHROPIC_MODEL || "glm-5.1";
  const prompt = buildSpecialistFirstPrompt({
    specialist,
    userRequest: [
      `Internal Review Worker: ${params.workerType}`,
      "You are an internal sub-agent invocation under the single public PR Reviewer specialist.",
      params.userRequest,
    ].join("\n\n"),
  });

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Review worker ${params.workerType} failed: ${response.status} ${text}`);
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

function parseJsonLoose(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenceStripped = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(fenceStripped);
    } catch {
      return { raw: trimmed };
    }
  }
}

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[truncated]`;
}
