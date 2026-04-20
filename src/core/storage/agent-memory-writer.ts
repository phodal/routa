import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentRole } from "../models/agent";
import { getSessionsDir } from "./folder-slug";

interface AgentMemoryScope {
  orchestrationSessionId: string;
  role: AgentRole;
  agentId?: string;
}

interface DelegationTreeChild {
  agentId: string;
  childSessionId?: string;
  role: AgentRole;
  taskId: string;
  taskTitle: string;
  provider: string;
  waitMode: "immediate" | "after_all";
  status: string;
  delegatedAt: string;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  verificationVerdict?: string;
  filesModified?: string[];
}

interface DelegationTreeSnapshot {
  orchestrationSessionId: string;
  updatedAt: string;
  children: DelegationTreeChild[];
}

export interface DelegationMemoryInput {
  orchestrationSessionId: string;
  parentAgentId: string;
  childAgentId: string;
  childSessionId?: string;
  childRole: AgentRole;
  taskId: string;
  taskTitle: string;
  taskObjective?: string;
  taskScope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  provider: string;
  waitMode: "immediate" | "after_all";
  timestamp?: string;
}

export interface ChildSessionMemoryInput {
  orchestrationSessionId: string;
  childSessionId: string;
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
  orchestrationSessionId: string;
  childSessionId: string;
  role: AgentRole;
  agentId: string;
  taskId: string;
  taskTitle: string;
  status: string;
  summary?: string;
  verificationVerdict?: string;
  verificationReport?: string;
  verificationResults?: string;
  filesModified?: string[];
  reportedSuccess?: boolean;
  timestamp?: string;
}

export interface SessionAgentMemorySnapshot {
  sessionId: string;
  baseDir: string;
  roles: Array<{
    directory: string;
    files: Array<{
      name: string;
      content: string;
    }>;
  }>;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function normalizeAgentId(agentId: string): string {
  const compact = agentId.replace(/[^a-zA-Z0-9]/g, "");
  return (compact || "agent").slice(0, 8);
}

function agentMemoryDirName(role: AgentRole, agentId?: string): string {
  if (role === AgentRole.ROUTA || !agentId) {
    return role;
  }
  return `${role}-${normalizeAgentId(agentId)}`;
}

function formatBulletSection(title: string, items?: string[], render?: (item: string) => string): string {
  if (!items || items.length === 0) return "";
  return `\n## ${title}\n${items.map((item) => `- ${render ? render(item) : item}`).join("\n")}\n`;
}

function approvalLabel(input: Pick<ChildCompletionMemoryInput, "verificationVerdict" | "reportedSuccess">): string {
  if (input.verificationVerdict) return input.verificationVerdict;
  if (input.reportedSuccess === false) return "NOT_APPROVED";
  if (input.reportedSuccess === true) return "APPROVED";
  return "UNKNOWN";
}

export class AgentMemoryWriter {
  constructor(private readonly projectPath: string) {}

  private getBaseDir(orchestrationSessionId: string): string {
    return path.join(getSessionsDir(this.projectPath), orchestrationSessionId, "agent-memory");
  }

  private getRoleDir(scope: AgentMemoryScope): string {
    return path.join(
      this.getBaseDir(scope.orchestrationSessionId),
      agentMemoryDirName(scope.role, scope.agentId),
    );
  }

  private async ensureRoleDir(scope: AgentMemoryScope): Promise<string> {
    const dir = this.getRoleDir(scope);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private async writeText(scope: AgentMemoryScope, fileName: string, content: string): Promise<void> {
    const dir = await this.ensureRoleDir(scope);
    await fs.writeFile(path.join(dir, fileName), content, "utf-8");
  }

  private async appendText(scope: AgentMemoryScope, fileName: string, content: string): Promise<void> {
    const dir = await this.ensureRoleDir(scope);
    await fs.appendFile(path.join(dir, fileName), content, "utf-8");
  }

  private async writeJson(scope: AgentMemoryScope, fileName: string, payload: unknown): Promise<void> {
    const dir = await this.ensureRoleDir(scope);
    await fs.writeFile(path.join(dir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }

  private async appendJsonl(scope: AgentMemoryScope, fileName: string, payload: unknown): Promise<void> {
    const dir = await this.ensureRoleDir(scope);
    await fs.appendFile(path.join(dir, fileName), `${JSON.stringify(payload)}\n`, "utf-8");
  }

  private async readJsonFile<T>(filePath: string): Promise<T | undefined> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as T;
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  private async appendTaskPlanSection(input: DelegationMemoryInput): Promise<void> {
    const scope = { orchestrationSessionId: input.orchestrationSessionId, role: AgentRole.ROUTA };
    const dir = await this.ensureRoleDir(scope);
    const filePath = path.join(dir, "task-plan.md");
    const marker = `<!-- task:${input.taskId} -->`;
    const existing = await fs.readFile(filePath, "utf-8").catch((error: unknown) => {
      if (isNotFoundError(error)) return "";
      throw error;
    });
    if (existing.includes(marker)) {
      return;
    }

    const section =
      `${existing ? "\n" : ""}${marker}\n` +
      `## ${input.taskTitle} (${input.taskId})\n\n` +
      `### Objective\n${input.taskObjective ?? "Not captured"}\n` +
      `${input.taskScope ? `\n### Scope\n${input.taskScope}\n` : ""}` +
      `${formatBulletSection("Acceptance Criteria", input.acceptanceCriteria)}` +
      `${formatBulletSection("Verification Commands", input.verificationCommands, (command) => `\`${command}\``)}` +
      `${formatBulletSection("Test Cases", input.testCases)}`;

    await fs.writeFile(filePath, `${existing}${section}`, "utf-8");
  }

  private async updateDelegationTree(
    orchestrationSessionId: string,
    timestamp: string,
    mutate: (snapshot: DelegationTreeSnapshot) => void,
  ): Promise<DelegationTreeSnapshot> {
    const scope = { orchestrationSessionId, role: AgentRole.ROUTA };
    const filePath = path.join(this.getRoleDir(scope), "delegation-tree.json");
    const snapshot = (await this.readJsonFile<DelegationTreeSnapshot>(filePath)) ?? {
      orchestrationSessionId,
      updatedAt: timestamp,
      children: [],
    };
    mutate(snapshot);
    snapshot.updatedAt = timestamp;
    await this.writeJson(scope, "delegation-tree.json", snapshot);
    await this.writeRoutaContextSummary(orchestrationSessionId, snapshot);
    return snapshot;
  }

  private async writeRoutaContextSummary(
    orchestrationSessionId: string,
    snapshot: DelegationTreeSnapshot,
  ): Promise<void> {
    const statusCounts = snapshot.children.reduce<Record<string, number>>((counts, child) => {
      counts[child.status] = (counts[child.status] ?? 0) + 1;
      return counts;
    }, {});

    const lines = [
      `Orchestration Session: ${orchestrationSessionId}`,
      `Delegated Agents: ${snapshot.children.length}`,
      `UpdatedAt: ${snapshot.updatedAt}`,
      ...Object.entries(statusCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => `${status}: ${count}`),
      "",
      ...snapshot.children.map((child) =>
        [
          `- ${child.role} ${child.agentId}`,
          `  Task: ${child.taskTitle} (${child.taskId})`,
          `  Status: ${child.status}`,
          child.childSessionId ? `  ChildSession: ${child.childSessionId}` : undefined,
          child.summary ? `  Summary: ${child.summary}` : undefined,
          child.verificationVerdict ? `  Verification: ${child.verificationVerdict}` : undefined,
        ]
          .filter(Boolean)
          .join("\n")
      ),
    ];

    await this.writeText(
      { orchestrationSessionId, role: AgentRole.ROUTA },
      "context-summary.txt",
      `${lines.join("\n")}\n`,
    );
  }

  async recordDelegation(input: DelegationMemoryInput): Promise<void> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const delegationEvent = {
      type: "delegation",
      timestamp,
      parentAgentId: input.parentAgentId,
      childAgentId: input.childAgentId,
      childSessionId: input.childSessionId,
      childRole: input.childRole,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      provider: input.provider,
      waitMode: input.waitMode,
    };

    const routaScope = { orchestrationSessionId: input.orchestrationSessionId, role: AgentRole.ROUTA };
    await this.appendJsonl(routaScope, "delegation-tree.jsonl", delegationEvent);
    await this.appendText(
      routaScope,
      "decisions.md",
      `- ${timestamp}: Delegated **${input.taskTitle}** (${input.taskId}) to ${input.childRole} agent ${input.childAgentId} via ${input.provider} (wait mode: ${input.waitMode}).\n`,
    );
    await this.appendTaskPlanSection(input);

    await this.updateDelegationTree(input.orchestrationSessionId, timestamp, (snapshot) => {
      const existing = snapshot.children.find((child) => child.agentId === input.childAgentId);
      if (existing) {
        existing.role = input.childRole;
        existing.taskId = input.taskId;
        existing.taskTitle = input.taskTitle;
        existing.provider = input.provider;
        existing.waitMode = input.waitMode;
        existing.childSessionId = input.childSessionId;
        existing.status = "delegated";
        existing.delegatedAt = timestamp;
        return;
      }
      snapshot.children.push({
        agentId: input.childAgentId,
        childSessionId: input.childSessionId,
        role: input.childRole,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        provider: input.provider,
        waitMode: input.waitMode,
        status: "delegated",
        delegatedAt: timestamp,
      });
    });
  }

  async recordChildSessionStart(input: ChildSessionMemoryInput): Promise<void> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const notesFile = input.role === AgentRole.GATE ? "review-findings.md" : "implementation-notes.md";
    const scope = {
      orchestrationSessionId: input.orchestrationSessionId,
      role: input.role,
      agentId: input.agentId,
    };

    const summary = [
      `Task: ${input.taskTitle} (${input.taskId})`,
      `Agent: ${input.agentId}`,
      `Role: ${input.role}`,
      `Parent: ${input.parentAgentId}`,
      `Provider: ${input.provider}`,
      `OrchestrationSession: ${input.orchestrationSessionId}`,
      `ChildSession: ${input.childSessionId}`,
      `StartedAt: ${timestamp}`,
    ].join("\n");

    await this.writeText(scope, "context-summary.txt", `${summary}\n`);
    await this.writeText(
      scope,
      notesFile,
      `# ${input.role} working memory\n\n## Session start\n\n${summary}\n\n## Delegation prompt\n\n${input.initialPrompt}\n`,
    );
    await this.appendJsonl(scope, "activity-log.jsonl", {
      type: "session_started",
      timestamp,
      childSessionId: input.childSessionId,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      provider: input.provider,
    });

    await this.updateDelegationTree(input.orchestrationSessionId, timestamp, (snapshot) => {
      const child = snapshot.children.find((entry) => entry.agentId === input.agentId);
      if (!child) return;
      child.childSessionId = input.childSessionId;
      child.status = "started";
      child.startedAt = timestamp;
    });
  }

  async recordChildCompletion(input: ChildCompletionMemoryInput): Promise<void> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const scope = {
      orchestrationSessionId: input.orchestrationSessionId,
      role: input.role,
      agentId: input.agentId,
    };

    await this.appendJsonl(scope, "activity-log.jsonl", {
      type: "session_completed",
      timestamp,
      childSessionId: input.childSessionId,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      status: input.status,
      summary: input.summary,
      verificationVerdict: input.verificationVerdict,
      filesModified: input.filesModified,
    });

    if (input.filesModified && input.filesModified.length > 0) {
      for (const filePath of input.filesModified) {
        await this.appendJsonl(scope, "file-edit-log.jsonl", {
          type: "file_modified",
          timestamp,
          childSessionId: input.childSessionId,
          path: filePath,
        });
      }
    }

    if (input.role === AgentRole.GATE) {
      await this.writeJson(scope, "verification-status.json", {
        childSessionId: input.childSessionId,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        status: input.status,
        verdict: input.verificationVerdict,
        report: input.verificationReport,
        updatedAt: timestamp,
      });
      await this.appendText(
        scope,
        "review-findings.md",
        `\n## Completion ${timestamp}\n\nStatus: ${input.status}\nVerdict: ${input.verificationVerdict ?? "UNKNOWN"}\n` +
          (input.summary ? `Summary: ${input.summary}\n` : "") +
          (input.verificationReport ? `\n### Verification Report\n\n${input.verificationReport}\n` : ""),
      );
      await this.appendText(
        scope,
        "approval-record.md",
        `## ${timestamp}\n\n` +
          `- Task: ${input.taskTitle} (${input.taskId})\n` +
          `- Child Session: ${input.childSessionId}\n` +
          `- Approval: ${approvalLabel(input)}\n` +
          `- Status: ${input.status}\n` +
          (input.summary ? `- Summary: ${input.summary}\n` : ""),
      );
    } else {
      await this.writeJson(scope, "test-results.json", {
        childSessionId: input.childSessionId,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        status: input.status,
        summary: input.summary,
        verificationResults: input.verificationResults,
        filesModified: input.filesModified ?? [],
        updatedAt: timestamp,
      });
    }

    await this.updateDelegationTree(input.orchestrationSessionId, timestamp, (snapshot) => {
      const child = snapshot.children.find((entry) => entry.agentId === input.agentId);
      if (!child) return;
      child.childSessionId = input.childSessionId;
      child.status = input.status;
      child.completedAt = timestamp;
      child.summary = input.summary;
      child.verificationVerdict = input.verificationVerdict;
      child.filesModified = input.filesModified;
    });
  }

  async readSessionMemory(orchestrationSessionId: string): Promise<SessionAgentMemorySnapshot | undefined> {
    const baseDir = this.getBaseDir(orchestrationSessionId);
    let entries;
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }

    const roles = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const dirPath = path.join(baseDir, entry.name);
          const files = await fs.readdir(dirPath, { withFileTypes: true, encoding: "utf8" });
          const snapshots = await Promise.all(
            files
              .filter((file) => file.isFile())
              .sort((left, right) => left.name.localeCompare(right.name))
              .map(async (file) => ({
                name: file.name,
                content: await fs.readFile(path.join(dirPath, file.name), "utf-8"),
              })),
          );
          return {
            directory: entry.name,
            files: snapshots,
          };
        }),
    );

    return {
      sessionId: orchestrationSessionId,
      baseDir,
      roles,
    };
  }
}
