import { promises as fsp } from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { safeSpawn } from "@/core/utils/safe-exec";
import { isContextError, parseContext, resolveRepoRoot } from "../hooks/shared";

type AuditStatus = "ok" | "heuristic" | "error";
type AuditOverall = "通过" | "有条件通过" | "不通过";

type HarnessInstructionAuditSummary = {
  status: AuditStatus;
  provider: string;
  generatedAt: string;
  durationMs: number;
  totalScore: number | null;
  overall: AuditOverall | null;
  oneSentence: string | null;
  principles: {
    routing: number | null;
    protection: number | null;
    reflection: number | null;
    verification: number | null;
  };
  error?: string;
};

type HarnessInstructionsResponse = {
  generatedAt: string;
  repoRoot: string;
  fileName: string;
  relativePath: string;
  source: string;
  fallbackUsed: boolean;
  audit: HarnessInstructionAuditSummary | null;
};

const CANDIDATE_FILES = ["CLAUDE.md", "AGENTS.md"] as const;
const AUDIT_SPECIALIST_ID = "agents-md-auditor";
const AUDIT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_AUDIT_PROVIDER = process.env.HARNESS_INSTRUCTION_AUDIT_PROVIDER ?? "codex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBooleanParam(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function toScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.round(value);
  if (normalized < 0 || normalized > 5) return null;
  return normalized;
}

function extractJsonOutput(raw: string): string {
  const candidate = raw.trim();
  if (!candidate) {
    throw new Error("Command produced no output");
  }

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Fall through and try extracting a trailing JSON object.
  }

  const lastOpen = candidate.lastIndexOf("{");
  if (lastOpen < 0) {
    throw new Error("Unable to locate JSON output");
  }

  for (let index = lastOpen; index >= 0; index -= 1) {
    if (candidate[index] !== "{") continue;
    const snippet = candidate.slice(index).trim();
    if (!snippet.endsWith("}")) continue;
    try {
      JSON.parse(snippet);
      return snippet;
    } catch {
      // keep searching
    }
  }

  throw new Error("Unable to parse command JSON output");
}

function inferOverall(params: {
  routing: number;
  protection: number;
  reflection: number;
  verification: number;
  hasAgentSideEffects: boolean;
}): AuditOverall {
  const { routing, protection, reflection, verification, hasAgentSideEffects } = params;
  const scores = [routing, protection, reflection, verification];

  if (scores.some((score) => score <= 2)) {
    return "不通过";
  }

  if (hasAgentSideEffects && (protection < 4 || verification < 4)) {
    return "有条件通过";
  }

  if (scores.every((score) => score >= 4)) {
    return "通过";
  }

  if (!scores.some((score) => score <= 1) && scores.filter((score) => score >= 3).length >= 3) {
    return "有条件通过";
  }

  return "不通过";
}

function buildHeuristicAudit(source: string, durationMs: number, provider: string, error?: string): HarnessInstructionAuditSummary {
  const normalized = source.toLowerCase();

  const hasAgentSideEffects = /(tool|tools|execute|command|write file|修改|执行命令|调用工具|发消息|external system|外部系统)/i.test(source);
  const routingSignals = [
    /repository map|feature tree|table of contents|目录/.test(normalized),
    /start here|entry point|先.*再|follow this sequence|按需/.test(source),
    /docs\/|path|module|workspace|目录|文件路径/.test(source),
    /do not.*knowledge dump|最小上下文|最小化/.test(source),
    /when|if|阶段|phase/.test(source),
  ];
  const protectionSignals = [
    /do not|don't|never|must not|不得|禁止/.test(source),
    /allowlist|denylist|scope|boundary|权限边界|范围限制/.test(source),
    /confirm|approval|升级|escalat/.test(source),
    /injection|prompt injection|注入/.test(source),
    /越权|drift|误操作|风险/.test(source),
  ];
  const reflectionSignals = [
    /fail|failure|错误|失败/.test(source),
    /retry|重试|最多/.test(source),
    /analy(s|z)e|原因|根因|first principle|第一性原理/.test(source),
    /switch strategy|换策略|分解任务|缩小问题/.test(source),
    /stop|卡住|升级处理/.test(source),
  ];
  const verificationSignals = [
    /definition of done|完成标准|验收条件/.test(source),
    /lint|test|typecheck|build|dry-run|checklist|schema check/.test(normalized),
    /if any step fails|fix and re-validate|未通过验证|不得宣称完成/.test(source),
    /evidence|report|输出验证结果|失败原因/.test(source),
    /before any pr|完成前|must run/.test(source),
  ];

  const routing = Math.min(5, routingSignals.filter(Boolean).length);
  const protection = Math.min(5, protectionSignals.filter(Boolean).length);
  const reflection = Math.min(5, reflectionSignals.filter(Boolean).length);
  const verification = Math.min(5, verificationSignals.filter(Boolean).length);
  const totalScore = routing + protection + reflection + verification;
  const overall = inferOverall({ routing, protection, reflection, verification, hasAgentSideEffects });

  return {
    status: "heuristic",
    provider,
    generatedAt: new Date().toISOString(),
    durationMs,
    totalScore,
    overall,
    oneSentence: "specialist 调用失败，当前展示为本地启发式评分（用于 UI 可用性，不作为最终审计结论）。",
    principles: {
      routing,
      protection,
      reflection,
      verification,
    },
    ...(error ? { error } : {}),
  };
}

function parseAuditPayload(
  payload: unknown,
  durationMs: number,
  provider: string,
): HarnessInstructionAuditSummary {
  const value = payload as {
    audit_conclusion?: {
      overall?: unknown;
      total_score?: unknown;
      one_sentence?: unknown;
    };
    principles?: {
      routing?: { score?: unknown };
      protection?: { score?: unknown };
      reflection?: { score?: unknown };
      verification?: { score?: unknown };
    };
  };

  const routing = toScore(value?.principles?.routing?.score);
  const protection = toScore(value?.principles?.protection?.score);
  const reflection = toScore(value?.principles?.reflection?.score);
  const verification = toScore(value?.principles?.verification?.score);
  const totalScore = typeof value?.audit_conclusion?.total_score === "number"
    ? Math.max(0, Math.min(20, Math.round(value.audit_conclusion.total_score)))
    : null;
  const overall = typeof value?.audit_conclusion?.overall === "string"
    && (value.audit_conclusion.overall === "通过" || value.audit_conclusion.overall === "有条件通过" || value.audit_conclusion.overall === "不通过")
    ? value.audit_conclusion.overall
    : null;
  const oneSentence = typeof value?.audit_conclusion?.one_sentence === "string"
    ? value.audit_conclusion.one_sentence
    : null;

  return {
    status: "ok",
    provider,
    generatedAt: new Date().toISOString(),
    durationMs,
    totalScore,
    overall,
    oneSentence,
    principles: {
      routing,
      protection,
      reflection,
      verification,
    },
  };
}

async function executeAuditorCommand(repoRoot: string, workspaceId: string, source: string, provider: string) {
  const localBinaryPath = path.join(repoRoot, "target", "debug", "routa");
  let command = localBinaryPath;
  let args = [
    "specialist",
    "run",
    "--json",
    "--workspace-id",
    workspaceId,
    "--provider",
    provider,
    "--provider-timeout-ms",
    "30000",
    "--provider-retries",
    "0",
    "-p",
    source,
    AUDIT_SPECIALIST_ID,
  ];

  try {
    await fsp.access(localBinaryPath);
  } catch {
    command = "cargo";
    args = ["run", "-p", "routa-cli", "--", ...args];
  }

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = safeSpawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, AUDIT_COMMAND_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Instruction audit command timed out after ${AUDIT_COMMAND_TIMEOUT_MS}ms`));
        return;
      }
      if (signal) {
        reject(new Error(`Instruction audit command terminated by signal: ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Instruction audit command failed (exit ${code}): ${(stderr || stdout).trim()}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runInstructionAudit(
  repoRoot: string,
  workspaceId: string,
  source: string,
  provider: string,
): Promise<HarnessInstructionAuditSummary> {
  const start = Date.now();
  try {
    const { stdout } = await executeAuditorCommand(repoRoot, workspaceId, source, provider);
    const parsed = JSON.parse(extractJsonOutput(stdout));
    const durationMs = Date.now() - start;
    return parseAuditPayload(parsed, durationMs, provider);
  } catch (error) {
    const durationMs = Date.now() - start;
    return buildHeuristicAudit(source, durationMs, provider, toMessage(error));
  }
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const workspaceId = context.workspaceId?.trim() || "default";
    const includeAudit = parseBooleanParam(request.nextUrl.searchParams.get("includeAudit"));
    const auditProvider = request.nextUrl.searchParams.get("auditProvider")?.trim() || DEFAULT_AUDIT_PROVIDER;
    const repoRoot = await resolveRepoRoot(context);

    let matched: { fileName: string; absolutePath: string } | null = null;
    for (const fileName of CANDIDATE_FILES) {
      const absolutePath = path.join(repoRoot, fileName);
      try {
        const stat = await fsp.stat(absolutePath);
        if (stat.isFile()) {
          matched = { fileName, absolutePath };
          break;
        }
      } catch {
        continue;
      }
    }

    if (!matched) {
      return NextResponse.json(
        {
          error: "未找到仓库指导文档",
          details: `Expected one of: ${CANDIDATE_FILES.join(", ")}`,
        },
        { status: 404 },
      );
    }

    const source = await fsp.readFile(matched.absolutePath, "utf-8");
    const audit = includeAudit ? await runInstructionAudit(repoRoot, workspaceId, source, auditProvider) : null;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot,
      fileName: matched.fileName,
      relativePath: path.relative(repoRoot, matched.absolutePath),
      source,
      fallbackUsed: matched.fileName !== CANDIDATE_FILES[0],
      audit,
    } satisfies HarnessInstructionsResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Harness 指导文档上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 Harness 指导文档失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
