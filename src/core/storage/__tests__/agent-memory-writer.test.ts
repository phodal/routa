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
  it("writes ROUTA delegation memory and child session start", async () => {
    const writer = new AgentMemoryWriter("/test/project");

    await writer.recordDelegation({
      sessionId: "sess-1",
      parentAgentId: "routa-1",
      childAgentId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      childRole: AgentRole.CRAFTER,
      taskId: "task-1",
      taskTitle: "Implement memory writer",
      provider: "claude",
      waitMode: "immediate",
      timestamp: "2026-04-05T00:00:00.000Z",
    });

    await writer.recordChildSessionStart({
      sessionId: "sess-1",
      role: AgentRole.CRAFTER,
      agentId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      taskId: "task-1",
      taskTitle: "Implement memory writer",
      parentAgentId: "routa-1",
      provider: "claude",
      initialPrompt: "Please implement it.",
      timestamp: "2026-04-05T00:00:01.000Z",
    });

    const routaDir = path.join(tmpDir, ".routa/projects/test-project/sessions/sess-1/agent-memory/ROUTA");
    const decisions = await fs.readFile(path.join(routaDir, "decisions.md"), "utf-8");
    expect(decisions).toContain("Delegated **Implement memory writer**");

    const delegationTree = await fs.readFile(path.join(routaDir, "delegation-tree.jsonl"), "utf-8");
    expect(delegationTree).toContain('"type":"delegation"');

    const crafterDir = path.join(tmpDir, ".routa/projects/test-project/sessions/sess-1/agent-memory/CRAFTER-12345678");
    const summary = await fs.readFile(path.join(crafterDir, "context-summary.txt"), "utf-8");
    expect(summary).toContain("Role: CRAFTER");

    const notes = await fs.readFile(path.join(crafterDir, "implementation-notes.md"), "utf-8");
    expect(notes).toContain("Please implement it.");
  });

  it("writes completion memory for gate verification", async () => {
    const writer = new AgentMemoryWriter("/test/project");

    await writer.recordChildCompletion({
      sessionId: "sess-2",
      role: AgentRole.GATE,
      agentId: "gate-agent",
      taskId: "task-2",
      taskTitle: "Verify implementation",
      status: "DONE",
      summary: "Verified",
      verificationVerdict: "pass",
      verificationReport: "All checks green",
      snapshotSource: "reported",
      timestamp: "2026-04-05T00:00:02.000Z",
    });

    const gateDir = path.join(tmpDir, ".routa/projects/test-project/sessions/sess-2/agent-memory/GATE-gate-age");
    const status = JSON.parse(await fs.readFile(path.join(gateDir, "verification-status.json"), "utf-8"));
    expect(status.verdict).toBe("pass");
    expect(status.snapshotSource).toBe("reported");

    const log = await fs.readFile(path.join(gateDir, "activity-log.jsonl"), "utf-8");
    const [entry] = log.trim().split("\n");
    expect(entry).toContain('"session_completed"');
    expect(JSON.parse(entry)).toMatchObject({
      verificationReport: "All checks green",
      snapshotSource: "reported",
    });
  });
});
