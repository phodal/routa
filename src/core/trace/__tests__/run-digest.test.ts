import { describe, expect, it } from "vitest";
import { AgentRole } from "@/core/models/agent";
import {
  buildTraceRunDigest,
  formatTraceContextForSpecialist,
  formatTracePreflightForCrafter,
  formatTraceStateForGate,
} from "../run-digest";
import type { TraceRecord } from "../types";

const baseRecord = (overrides: Partial<TraceRecord>): TraceRecord => ({
  version: "0.1.0",
  id: overrides.id ?? "trace-id",
  timestamp: overrides.timestamp ?? "2026-04-09T00:00:00.000Z",
  sessionId: overrides.sessionId ?? "session-parent",
  contributor: overrides.contributor ?? { provider: "test" },
  eventType: overrides.eventType ?? "tool_call",
  ...overrides,
});

describe("TraceRunDigest", () => {
  it("builds deterministic runtime state from paired tool calls", () => {
    const records: TraceRecord[] = [
      baseRecord({
        id: "05-missing-call",
        timestamp: "2026-04-09T00:00:05.000Z",
        eventType: "tool_call",
        tool: { name: "read_file", toolCallId: "tc-missing", input: { path: "src/core/trace/types.ts" } },
        files: [{ path: "src/core/trace/types.ts", operation: "read" }],
      }),
      baseRecord({
        id: "02-failed-result",
        timestamp: "2026-04-09T00:00:02.000Z",
        eventType: "tool_result",
        tool: { name: "bash", toolCallId: "tc-test-1", status: "failed", output: "failed" },
        metadata: { toolCallContentPath: "/tmp/context/tc-test-1/content.json" },
      }),
      baseRecord({
        id: "01-failed-call",
        timestamp: "2026-04-09T00:00:01.000Z",
        eventType: "tool_call",
        tool: { name: "bash", toolCallId: "tc-test-1", input: { command: "npx vitest run src/core/trace/__tests__" } },
        files: [{ path: "src/core/trace/run-digest.ts", operation: "read" }],
        metadata: {
          toolCallContentPath: "/tmp/context/tc-test-1/content.json",
          toolCallMetadataPath: "/tmp/context/tc-test-1/metadata.json",
        },
        vcs: { branch: "issue/trace", revision: "abc123", repoRoot: "/repo" },
      }),
      baseRecord({
        id: "04-success-result",
        timestamp: "2026-04-09T00:00:04.000Z",
        eventType: "tool_result",
        tool: { name: "edit", toolCallId: "tc-edit", status: "completed", output: "ok" },
      }),
      baseRecord({
        id: "03-success-call",
        timestamp: "2026-04-09T00:00:03.000Z",
        eventType: "tool_call",
        tool: { name: "edit", toolCallId: "tc-edit", input: { path: "src/core/trace/run-digest.ts" } },
        files: [{ path: "src/core/trace/run-digest.ts", operation: "write" }],
      }),
      baseRecord({
        id: "06-retry-call",
        timestamp: "2026-04-09T00:00:06.000Z",
        eventType: "tool_call",
        tool: { name: "bash", toolCallId: "tc-test-2", input: { command: "npx vitest run src/core/trace/__tests__" } },
      }),
      baseRecord({
        id: "07-retry-result",
        timestamp: "2026-04-09T00:00:07.000Z",
        eventType: "tool_result",
        tool: { name: "bash", toolCallId: "tc-test-2", status: "failed", output: "failed again" },
      }),
    ];

    const digest = buildTraceRunDigest(records);
    const rebuiltDigest = buildTraceRunDigest([...records].reverse());

    expect(rebuiltDigest).toEqual(digest);
    expect(digest.traceAvailable).toBe(true);
    expect(digest.sessionIds).toEqual(["session-parent"]);
    expect(digest.successfulTools.map((tool) => tool.toolCallId)).toEqual(["tc-edit"]);
    expect(digest.failedTools.map((tool) => tool.toolCallId)).toEqual(["tc-test-1", "tc-test-2"]);
    expect(digest.toolCallsMissingResult.map((tool) => tool.toolCallId)).toEqual(["tc-missing"]);
    expect(digest.observedVerificationCommands).toEqual(["npx vitest run src/core/trace/__tests__"]);
    expect(digest.touchedFiles.map((file) => `${file.path}:${file.count}`)).toEqual([
      "src/core/trace/run-digest.ts:2",
      "src/core/trace/types.ts:1",
    ]);
    expect(digest.hotFiles.map((file) => file.path)).toEqual(["src/core/trace/run-digest.ts"]);
    expect(digest.retrySignals).toEqual([
      {
        key: "npx vitest run src/core/trace/__tests__",
        count: 2,
        kind: "failed_tool",
      },
    ]);
    expect(digest.toolCallContextPaths).toEqual([
      "/tmp/context/tc-test-1/content.json",
      "/tmp/context/tc-test-1/metadata.json",
    ]);
    expect(digest.vcsContexts).toEqual([
      { branch: "issue/trace", revision: "abc123", repoRoot: "/repo" },
    ]);
  });

  it("keeps missing trace and verification evidence gaps explicit", () => {
    const digest = buildTraceRunDigest([]);

    expect(digest.traceAvailable).toBe(false);
    expect(digest.evidenceGaps).toContain("No readable trace records found for the delegated session context.");
    expect(digest.evidenceGaps).toContain("No structured verification command was observed in trace.");
    expect(formatTraceStateForGate(digest)).toContain("traceAvailable: no");
  });

  it("formats different trace context for Gate and Crafter specialists", () => {
    const digest = buildTraceRunDigest([
      baseRecord({
        id: "call",
        timestamp: "2026-04-09T00:00:01.000Z",
        eventType: "tool_call",
        tool: { name: "bash", toolCallId: "tc-test", input: { command: "npm test" } },
        files: [{ path: "src/core/orchestration/orchestrator.ts", operation: "read" }],
      }),
      baseRecord({
        id: "result",
        timestamp: "2026-04-09T00:00:02.000Z",
        eventType: "tool_result",
        tool: { name: "bash", toolCallId: "tc-test", status: "failed", output: "failed" },
      }),
    ]);

    const gateContext = formatTraceContextForSpecialist(AgentRole.GATE, digest);
    const crafterContext = formatTraceContextForSpecialist(AgentRole.CRAFTER, digest);

    expect(gateContext).toContain("## Trace State");
    expect(gateContext).toContain("### Observed verification commands");
    expect(gateContext).toContain("### Tool calls missing tool_result");
    expect(crafterContext).toContain("## Trace Preflight");
    expect(crafterContext).toContain("### Files already touched");
    expect(crafterContext).toContain("Recent failed commands");
    expect(crafterContext).not.toContain("Observed verification commands");
    expect(crafterContext).not.toContain("Tool calls missing tool_result");
    expect(formatTracePreflightForCrafter(digest)).toBe(crafterContext);
  });
});
