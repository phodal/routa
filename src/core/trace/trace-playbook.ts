import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentRole } from "../models/agent";
import type { RunOutcome } from "./run-outcome";
import { readRunOutcomesByFingerprint } from "./run-outcome";
import { getVcsContextSync } from "./vcs-context";

export interface LearnedPlaybook {
  fingerprint: string;
  taskType: RunOutcome["taskType"];
  workspaceId: string;
  taskTitle: string;
  sampleSize: number;
  successRate: number;
  preferredTools: string[];
  keyFiles: string[];
  verificationCommands: string[];
  antiPatterns: string[];
  sourceSessions: string[];
}

interface LearnedPlaybookArtifact {
  id: string;
  taskType: RunOutcome["taskType"];
  confidence: number;
  match: {
    fingerprint: string;
    workspaceId: string;
    taskTitle: string;
    boardId?: string;
    columnId?: string;
    labels?: string[];
  };
  strategy: {
    preferredToolOrder: string[];
    keyFiles: string[];
    verificationCommands: string[];
    antiPatterns: string[];
  };
  provenance: {
    sourceRuns: string[];
    sourceSessions: string[];
    successRate: number;
    evidenceCount: number;
    generatedAt: string;
  };
}

const MAX_ITEMS = 8;
const MIN_PLAYBOOK_SAMPLES = 2;

export async function loadLearnedPlaybook(
  cwd: string,
  fingerprint: string,
  taskTitle?: string,
  workspaceId?: string,
): Promise<LearnedPlaybook | null> {
  const outcomes = await readRunOutcomesByFingerprint(cwd, fingerprint);
  if (outcomes.length < MIN_PLAYBOOK_SAMPLES) {
    return null;
  }
  return buildPlaybookFromOutcomes(outcomes, taskTitle, workspaceId);
}

export async function syncLearnedPlaybookArtifact(
  cwd: string,
  fingerprint: string,
  taskTitle?: string,
  workspaceId?: string,
): Promise<LearnedPlaybook | null> {
  const outcomes = await readRunOutcomesByFingerprint(cwd, fingerprint);
  const playbook = buildPlaybookFromOutcomes(outcomes, taskTitle, workspaceId);
  if (!playbook) {
    return null;
  }

  const repoRoot = outcomes.find((outcome) => outcome.repoRoot)?.repoRoot
    ?? getVcsContextSync(cwd)?.repoRoot;
  if (!repoRoot) {
    return playbook;
  }

  const artifact = buildPlaybookArtifact(playbook, outcomes);
  const artifactDir = path.join(repoRoot, "docs", "fitness", "playbooks");
  const artifactPath = path.join(artifactDir, `${artifact.id}.json`);

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return playbook;
}

export function buildPlaybookFromOutcomes(
  outcomes: RunOutcome[],
  taskTitleFallback?: string,
  workspaceIdFallback?: string,
): LearnedPlaybook | null {
  if (outcomes.length < MIN_PLAYBOOK_SAMPLES) {
    return null;
  }

  const sampleSize = outcomes.length;
  const successCount = outcomes.filter((outcome) => outcome.outcome === "success").length;
  const successRate = sampleSize === 0 ? 0 : successCount / sampleSize;
  const toolFrequency = new Map<string, number>();
  const fileFrequency = new Map<string, number>();
  const verificationFrequency = new Map<string, { passes: number; total: number }>();
  const antiPatterns = new Set<string>();
  const sourceSessions: string[] = [];

  for (const outcome of outcomes) {
    if (sourceSessions.length < MAX_ITEMS) {
      sourceSessions.push(outcome.sessionId);
    }

    const toolSequence = outcome.toolSequence.length > 0
      ? outcome.toolSequence
      : outcome.digest.toolCalls.map((tool) => tool.name);
    const changedFiles = outcome.changedFiles.length > 0
      ? outcome.changedFiles
      : outcome.digest.filesTouched
        .filter((file) => file.operations.some((operation) => operation !== "read"))
        .map((file) => file.path);
    const weight = outcome.outcome === "success" ? 2 : 1;

    for (const tool of toolSequence) {
      toolFrequency.set(tool, (toolFrequency.get(tool) ?? 0) + weight);
    }

    for (const file of changedFiles) {
      fileFrequency.set(file, (fileFrequency.get(file) ?? 0) + weight);
    }

    for (const signal of outcome.digest.verificationSignals) {
      const stats = verificationFrequency.get(signal.command) ?? { passes: 0, total: 0 };
      verificationFrequency.set(signal.command, {
        passes: stats.passes + (signal.passed ? 1 : 0),
        total: stats.total + 1,
      });
    }

    if (outcome.outcome === "success") {
      continue;
    }

    if (outcome.failureMode) {
      antiPatterns.add(`Failure mode: ${formatReason(outcome.failureMode)}`);
    }
    if (outcome.loopDetected && outcome.bouncePattern && outcome.bouncePattern.length > 1) {
      antiPatterns.add(`Loop detected across lanes: ${outcome.bouncePattern.join(" -> ")}`);
    }
    outcome.recoveryActions?.forEach((action) => {
      antiPatterns.add(`Recovery required: ${formatReason(action)}`);
    });
    outcome.digest.confidenceFlags.forEach((flag) => antiPatterns.add(flag));
    outcome.digest.verificationSignals
      .filter((signal) => !signal.passed)
      .forEach((signal) => antiPatterns.add(`Verification failed: ${signal.command}`));
    outcome.digest.churnMarkers.forEach((marker) => {
      antiPatterns.add(
        marker.type === "file"
          ? `High churn on ${marker.target}`
          : `Repeated tool failures: ${marker.target}`,
      );
    });
  }

  return {
    fingerprint: outcomes[0].fingerprint,
    taskType: outcomes[0].taskType,
    workspaceId: outcomes[0].workspaceId ?? workspaceIdFallback ?? "workspace-unknown",
    taskTitle: outcomes[0].taskTitle ?? taskTitleFallback ?? "unknown task",
    sampleSize,
    successRate,
    preferredTools: topRanked(toolFrequency),
    keyFiles: topRanked(fileFrequency),
    verificationCommands: Array.from(verificationFrequency.entries())
      .sort((left, right) => right[1].passes - left[1].passes)
      .slice(0, MAX_ITEMS)
      .map(([command, stats]) => {
        const passRate = stats.total === 0 ? 0 : Math.round((stats.passes / stats.total) * 100);
        return `${command} (${passRate}% pass over ${stats.total} run${stats.total > 1 ? "s" : ""})`;
      }),
    antiPatterns: Array.from(antiPatterns).slice(0, MAX_ITEMS),
    sourceSessions,
  };
}

export function formatPlaybookForRole(playbook: LearnedPlaybook, role: AgentRole): string {
  const lines: string[] = [];
  const isGate = role === AgentRole.GATE;

  lines.push("## Learned Playbook (prior runs)");
  lines.push(
    `Confidence: ${(playbook.successRate * 100).toFixed(0)}% from ${playbook.sampleSize} related run(s)`,
  );
  lines.push(`Provenance sessions: ${playbook.sourceSessions.join(", ")}`);
  lines.push("");

  if (playbook.preferredTools.length > 0) {
    lines.push(isGate ? "### Common Tool Flow" : "### Preferred Tool Order");
    playbook.preferredTools.forEach((tool, index) => {
      lines.push(`${index + 1}. ${tool}`);
    });
    lines.push("");
  }

  if (playbook.keyFiles.length > 0) {
    lines.push(isGate ? "### Areas to Inspect" : "### Files Commonly Touched");
    playbook.keyFiles.forEach((file) => lines.push(`- \`${file}\``));
    lines.push("");
  }

  if (playbook.verificationCommands.length > 0) {
    lines.push(isGate ? "### Verification to Repeat" : "### Checks Often Used");
    playbook.verificationCommands.forEach((command) => lines.push(`- ${command}`));
    lines.push("");
  }

  if (playbook.antiPatterns.length > 0) {
    lines.push(isGate ? "### Anti-Patterns / Risks" : "### Avoid / Risks");
    playbook.antiPatterns.forEach((antiPattern) => lines.push(`- ${antiPattern}`));
    lines.push("");
  }

  return lines.join("\n");
}

function topRanked(values: Map<string, number>): string[] {
  return Array.from(values.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_ITEMS)
    .map(([name]) => name);
}

function buildPlaybookArtifact(
  playbook: LearnedPlaybook,
  outcomes: RunOutcome[],
): LearnedPlaybookArtifact {
  const latestOutcome = outcomes[outcomes.length - 1];
  const cardFingerprint = latestOutcome?.cardFingerprint;

  return {
    id: buildPlaybookArtifactId(playbook),
    taskType: playbook.taskType,
    confidence: Number(playbook.successRate.toFixed(2)),
    match: {
      fingerprint: playbook.fingerprint,
      workspaceId: playbook.workspaceId,
      taskTitle: playbook.taskTitle,
      boardId: cardFingerprint?.boardId,
      columnId: cardFingerprint?.columnId,
      labels: cardFingerprint?.labels,
    },
    strategy: {
      preferredToolOrder: playbook.preferredTools,
      keyFiles: playbook.keyFiles,
      verificationCommands: playbook.verificationCommands,
      antiPatterns: playbook.antiPatterns,
    },
    provenance: {
      sourceRuns: outcomes.map((outcome) => outcome.timestamp),
      sourceSessions: Array.from(new Set(playbook.sourceSessions)),
      successRate: Number(playbook.successRate.toFixed(2)),
      evidenceCount: playbook.sampleSize,
      generatedAt: new Date().toISOString(),
    },
  };
}

function buildPlaybookArtifactId(playbook: LearnedPlaybook): string {
  return `trace-learning-${playbook.taskType}-${playbook.fingerprint}`;
}

function formatReason(value: string): string {
  return value.replace(/_/g, " ");
}