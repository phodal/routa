/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AgentRole } from "@/core/models/agent";
import { AgentMemoryWriter } from "../agent-memory-writer";

let tmpDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpDir;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("AgentMemoryWriter", () => {
  it("writes aggregated orchestration memory for ROUTA and CRAFTER", async () => {
    const writer = new AgentMemoryWriter("/test/project");

    await writer.recordDelegation({
      orchestrationSessionId: "lead-sess-1",
      parentAgentId: "routa-1",
      childAgentId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      childSessionId: "child-sess-1",
      childRole: AgentRole.CRAFTER,
      taskId: "task-1",
      taskTitle: "Implement memory writer",
      taskObjective: "Persist multi-agent memory to files.",
      taskScope: "Storage layer only",
      acceptanceCriteria: ["Writes ROUTA task plan", "Tracks file edits"],
      verificationCommands: ["npm run test:run -- agent-memory"],
      testCases: ["Delegation writes aggregated memory"],
      provider: "claude",
      waitMode: "immediate",
      timestamp: "2026-04-05T00:00:00.000Z",
    });

    await writer.recordChildSessionStart({
      orchestrationSessionId: "lead-sess-1",
      childSessionId: "child-sess-1",
      role: AgentRole.CRAFTER,
      agentId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      taskId: "task-1",
      taskTitle: "Implement memory writer",
      parentAgentId: "routa-1",
      provider: "claude",
      initialPrompt: "Please implement it.",
      timestamp: "2026-04-05T00:00:01.000Z",
    });

    await writer.recordChildCompletion({
      orchestrationSessionId: "lead-sess-1",
      childSessionId: "child-sess-1",
      role: AgentRole.CRAFTER,
      agentId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      taskId: "task-1",
      taskTitle: "Implement memory writer",
      status: "COMPLETED",
      summary: "Implemented memory writer",
      verificationResults: "Vitest green",
      filesModified: ["src/core/storage/agent-memory-writer.ts", "src/core/orchestration/orchestrator.ts"],
      timestamp: "2026-04-05T00:00:02.000Z",
    });

    const routaDir = path.join(tmpDir, ".routa/projects/test-project/sessions/lead-sess-1/agent-memory/ROUTA");
    const decisions = await fs.readFile(path.join(routaDir, "decisions.md"), "utf-8");
    expect(decisions).toContain("Delegated **Implement memory writer**");

    const delegationTree = await fs.readFile(path.join(routaDir, "delegation-tree.jsonl"), "utf-8");
    expect(delegationTree).toContain('"type":"delegation"');
    const delegationSnapshot = JSON.parse(await fs.readFile(path.join(routaDir, "delegation-tree.json"), "utf-8"));
    expect(delegationSnapshot.children[0].status).toBe("COMPLETED");

    const taskPlan = await fs.readFile(path.join(routaDir, "task-plan.md"), "utf-8");
    expect(taskPlan).toContain("## Implement memory writer (task-1)");
    expect(taskPlan).toContain("Writes ROUTA task plan");
    const routaSummary = await fs.readFile(path.join(routaDir, "context-summary.txt"), "utf-8");
    expect(routaSummary).toContain("Delegated Agents: 1");

    const crafterDir = path.join(
      tmpDir,
      ".routa/projects/test-project/sessions/lead-sess-1/agent-memory/CRAFTER-12345678",
    );
    const summary = await fs.readFile(path.join(crafterDir, "context-summary.txt"), "utf-8");
    expect(summary).toContain("Role: CRAFTER");
    expect(summary).toContain("ChildSession: child-sess-1");

    const notes = await fs.readFile(path.join(crafterDir, "implementation-notes.md"), "utf-8");
    expect(notes).toContain("Please implement it.");

    const fileEditLog = await fs.readFile(path.join(crafterDir, "file-edit-log.jsonl"), "utf-8");
    expect(fileEditLog).toContain("agent-memory-writer.ts");

    const testResults = JSON.parse(await fs.readFile(path.join(crafterDir, "test-results.json"), "utf-8"));
    expect(testResults.verificationResults).toBe("Vitest green");
    expect(testResults.filesModified).toContain("src/core/orchestration/orchestrator.ts");
  });

  it("writes gate verification outputs and can read them back", async () => {
    const writer = new AgentMemoryWriter("/test/project");

    await writer.recordChildSessionStart({
      orchestrationSessionId: "lead-sess-2",
      childSessionId: "gate-child-sess",
      role: AgentRole.GATE,
      agentId: "gate-agent",
      taskId: "task-2",
      taskTitle: "Verify implementation",
      parentAgentId: "routa-1",
      provider: "claude",
      initialPrompt: "Verify the implementation.",
      timestamp: "2026-04-05T00:00:01.000Z",
    });

    await writer.recordChildCompletion({
      orchestrationSessionId: "lead-sess-2",
      childSessionId: "gate-child-sess",
      role: AgentRole.GATE,
      agentId: "gate-agent",
      taskId: "task-2",
      taskTitle: "Verify implementation",
      status: "DONE",
      summary: "Verified",
      verificationVerdict: "pass",
      verificationReport: "All checks green",
      timestamp: "2026-04-05T00:00:02.000Z",
    });

    const gateDir = path.join(tmpDir, ".routa/projects/test-project/sessions/lead-sess-2/agent-memory/GATE-gateagen");
    const status = JSON.parse(await fs.readFile(path.join(gateDir, "verification-status.json"), "utf-8"));
    expect(status.verdict).toBe("pass");

    const log = await fs.readFile(path.join(gateDir, "activity-log.jsonl"), "utf-8");
    expect(log).toContain('"session_completed"');

    const approvalRecord = await fs.readFile(path.join(gateDir, "approval-record.md"), "utf-8");
    expect(approvalRecord).toContain("Approval: pass");

    const findings = await fs.readFile(path.join(gateDir, "review-findings.md"), "utf-8");
    expect(findings).toContain("All checks green");

    const snapshot = await writer.readSessionMemory("lead-sess-2");
    expect(snapshot?.roles.map((role) => role.directory)).toContain("GATE-gateagen");
    expect(
      snapshot?.roles.find((role) => role.directory === "GATE-gateagen")?.files
        .some((file) => file.name === "approval-record.md"),
    ).toBe(true);
  });
});
