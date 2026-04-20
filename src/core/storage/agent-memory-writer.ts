import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentRole } from "../models/agent";
import { getSessionsDir } from "./folder-slug";

interface AgentMemoryScope {
  sessionId: string;
  role: AgentRole;
  agentId?: string;
}

export type CompletionSnapshotSource = "reported" | "auto" | "session_end" | "error";

export interface DelegationMemoryInput {
  sessionId: string;
  parentAgentId: string;
  childAgentId: string;
  childRole: AgentRole;
  taskId: string;
  taskTitle: string;
  provider: string;
  waitMode: "immediate" | "after_all";
  timestamp?: string;
}

export interface ChildSessionMemoryInput {
  sessionId: string;
  role: AgentRole;
  agentId: string;
  taskId: string;
  taskTitle: string;
  parentAgentId: string;
  provider: string;
  initialPrompt: string;
  timestamp?: string;
}

export interface ChildCompletionMemoryInput {
  sessionId: string;
  role: AgentRole;
  agentId: string;
  taskId: string;
  taskTitle: string;
  status: string;
  summary?: string;
  verificationVerdict?: string | null;
  verificationReport?: string | null;
  snapshotSource?: CompletionSnapshotSource;
  timestamp?: string;
}

function agentMemoryDirName(role: AgentRole, agentId?: string): string {
  if (role === AgentRole.ROUTA || !agentId) {
    return role;
  }
  return `${role}-${agentId.slice(0, 8)}`;
}

export class AgentMemoryWriter {
  constructor(private readonly projectPath: string) {}

  private getBaseDir(sessionId: string): string {
    return path.join(getSessionsDir(this.projectPath), sessionId, "agent-memory");
  }

  private getRoleDir(scope: AgentMemoryScope): string {
    return path.join(
      this.getBaseDir(scope.sessionId),
      agentMemoryDirName(scope.role, scope.agentId),
    );
  }

  private async writeText(scope: AgentMemoryScope, fileName: string, content: string): Promise<void> {
    const dir = this.getRoleDir(scope);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), content, "utf-8");
  }

  private async writeJson(scope: AgentMemoryScope, fileName: string, payload: unknown): Promise<void> {
    const dir = this.getRoleDir(scope);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }

  private async appendJsonl(scope: AgentMemoryScope, fileName: string, payload: unknown): Promise<void> {
    const dir = this.getRoleDir(scope);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, fileName), `${JSON.stringify(payload)}\n`, "utf-8");
  }

  async recordDelegation(input: DelegationMemoryInput): Promise<void> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const delegationEvent = {
      type: "delegation",
      timestamp,
      parentAgentId: input.parentAgentId,
      childAgentId: input.childAgentId,
      childRole: input.childRole,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      provider: input.provider,
      waitMode: input.waitMode,
    };

    await this.appendJsonl(
      { sessionId: input.sessionId, role: AgentRole.ROUTA },
      "delegation-tree.jsonl",
      delegationEvent,
    );

    const decisionMd = [
      `- ${timestamp}: Delegated **${input.taskTitle}** (${input.taskId}) to ${input.childRole} agent ${input.childAgentId} via ${input.provider} (wait mode: ${input.waitMode}).`,
    ].join("\n");

    const routaDir = this.getRoleDir({ sessionId: input.sessionId, role: AgentRole.ROUTA });
    await fs.mkdir(routaDir, { recursive: true });
    await fs.appendFile(path.join(routaDir, "decisions.md"), `${decisionMd}\n`, "utf-8");
  }

  async recordChildSessionStart(input: ChildSessionMemoryInput): Promise<void> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const notesFile = input.role === AgentRole.GATE ? "review-findings.md" : "implementation-notes.md";

    const summary = [
      `Task: ${input.taskTitle} (${input.taskId})`,
      `Agent: ${input.agentId}`,
      `Role: ${input.role}`,
      `Parent: ${input.parentAgentId}`,
      `Provider: ${input.provider}`,
      `StartedAt: ${timestamp}`,
    ].join("\n");

    await this.writeText(
      { sessionId: input.sessionId, role: input.role, agentId: input.agentId },
      "context-summary.txt",
      `${summary}\n`,
    );

    await this.writeText(
      { sessionId: input.sessionId, role: input.role, agentId: input.agentId },
      notesFile,
      `# ${input.role} working memory\n\n## Session start\n\n${summary}\n\n## Delegation prompt\n\n${input.initialPrompt}\n`,
    );

    await this.appendJsonl(
      { sessionId: input.sessionId, role: input.role, agentId: input.agentId },
      "activity-log.jsonl",
      {
        type: "session_started",
        timestamp,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        provider: input.provider,
      },
    );
  }

  async recordChildCompletion(input: ChildCompletionMemoryInput): Promise<void> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const scope = { sessionId: input.sessionId, role: input.role, agentId: input.agentId };
    await this.appendJsonl(scope, "activity-log.jsonl", {
      type: "session_completed",
      timestamp,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      status: input.status,
      summary: input.summary,
      verificationVerdict: input.verificationVerdict ?? null,
      verificationReport: input.verificationReport ?? null,
      snapshotSource: input.snapshotSource ?? null,
    });

    if (input.role === AgentRole.GATE) {
      await this.writeJson(scope, "verification-status.json", {
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        status: input.status,
        verdict: input.verificationVerdict ?? null,
        report: input.verificationReport ?? null,
        snapshotSource: input.snapshotSource ?? null,
        updatedAt: timestamp,
      });
    } else {
      await this.writeJson(scope, "test-results.json", {
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        status: input.status,
        summary: input.summary,
        snapshotSource: input.snapshotSource ?? null,
        updatedAt: timestamp,
      });
    }
  }
}
