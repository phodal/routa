/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { AgentRole } from "../../models/agent";
import type { TraceRecord } from "../types";
import {
  buildTraceRunDigest,
  formatDigestForRole,
} from "../trace-run-digest";

function makeRecord(
  sessionId: string,
  eventType: TraceRecord["eventType"],
  overrides: Partial<TraceRecord> = {},
): TraceRecord {
  return {
    version: "0.1.0",
    id: `trace-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    sessionId,
    contributor: { provider: "test" },
    eventType,
    ...overrides,
  };
}

describe("buildTraceRunDigest", () => {
  it("returns empty digest for no records", () => {
    const digest = buildTraceRunDigest("sess-1", []);
    expect(digest.sessionId).toBe("sess-1");
    expect(digest.totalEvents).toBe(0);
    expect(digest.filesTouched).toEqual([]);
    expect(digest.toolCalls).toEqual([]);
    expect(digest.errorCount).toBe(0);
    expect(digest.timeRange).toBeNull();
    expect(digest.verificationSignals).toEqual([]);
    expect(digest.churnMarkers).toEqual([]);
    expect(digest.confidenceFlags).toEqual([]);
  });

  it("collects file operations with touch counts", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        files: [
          { path: "src/index.ts", operation: "read" },
          { path: "src/utils.ts", operation: "write" },
        ],
      }),
      makeRecord("sess-1", "tool_call", {
        files: [
          { path: "src/index.ts", operation: "write" },
        ],
      }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.filesTouched).toHaveLength(2);

    const indexFile = digest.filesTouched.find((f) => f.path === "src/index.ts");
    expect(indexFile?.operations).toContain("read");
    expect(indexFile?.operations).toContain("write");
    expect(indexFile?.touchCount).toBe(2);

    const utilsFile = digest.filesTouched.find((f) => f.path === "src/utils.ts");
    expect(utilsFile?.operations).toEqual(["write"]);
    expect(utilsFile?.touchCount).toBe(1);
  });

  it("collects tool call statistics", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "read_file", toolCallId: "tc1", status: "running" },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "read_file", toolCallId: "tc1", status: "completed" },
      }),
      makeRecord("sess-1", "tool_call", {
        tool: { name: "write_file", toolCallId: "tc2", status: "running" },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "write_file", toolCallId: "tc2", status: "failed", output: "Permission denied" },
      }),
      makeRecord("sess-1", "tool_call", {
        tool: { name: "read_file", toolCallId: "tc3", status: "running" },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "read_file", toolCallId: "tc3", status: "completed" },
      }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.toolCalls).toHaveLength(2);

    const readFile = digest.toolCalls.find((t) => t.name === "read_file");
    expect(readFile?.count).toBe(2);
    expect(readFile?.failures).toBe(0);

    const writeFile = digest.toolCalls.find((t) => t.name === "write_file");
    expect(writeFile?.count).toBe(1);
    expect(writeFile?.failures).toBe(1);

    expect(digest.errorCount).toBe(1);
    expect(digest.errorSummaries).toContain("Permission denied");
  });

  it("collects key agent thoughts", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "agent_thought", {
        conversation: { contentPreview: "Analyzing the test failures in module X" },
      }),
      makeRecord("sess-1", "agent_thought", {
        conversation: { contentPreview: "The root cause is a missing import" },
      }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.keyThoughts).toHaveLength(2);
    expect(digest.keyThoughts[0]).toContain("Analyzing the test failures");
  });

  it("limits key thoughts to 3", () => {
    const records: TraceRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeRecord("sess-1", "agent_thought", {
        conversation: { contentPreview: `Thought ${i}` },
      }),
    );

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.keyThoughts).toHaveLength(3);
  });

  it("limits error summaries to 5", () => {
    const records: TraceRecord[] = Array.from({ length: 8 }, (_, i) =>
      makeRecord("sess-1", "tool_result", {
        tool: { name: `tool-${i}`, status: "failed", output: `Error ${i}` },
      }),
    );

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.errorSummaries).toHaveLength(5);
  });

  it("computes time range from timestamps", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "session_start", { timestamp: "2026-04-20T10:00:00Z" }),
      makeRecord("sess-1", "tool_call", { timestamp: "2026-04-20T10:05:00Z" }),
      makeRecord("sess-1", "session_end", { timestamp: "2026-04-20T10:10:00Z" }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.timeRange).toEqual({
      start: "2026-04-20T10:00:00Z",
      end: "2026-04-20T10:10:00Z",
    });
  });

  it("detects verification commands from shell tool calls", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "run_command", toolCallId: "tc1", status: "running", input: { command: "npm test" } },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "run_command", toolCallId: "tc1", status: "completed", output: "All tests passed" },
      }),
      makeRecord("sess-1", "tool_call", {
        tool: { name: "execute_command", toolCallId: "tc2", status: "running", input: { command: "npx eslint src/" } },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "execute_command", toolCallId: "tc2", status: "failed", output: "3 lint errors" },
      }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.verificationSignals).toHaveLength(2);

    const testSignal = digest.verificationSignals.find((v) => v.command.includes("npm test"));
    expect(testSignal?.passed).toBe(true);

    const lintSignal = digest.verificationSignals.find((v) => v.command.includes("eslint"));
    expect(lintSignal?.passed).toBe(false);
    expect(lintSignal?.outputSummary).toContain("3 lint errors");
  });

  it("does not flag non-verification shell commands", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "run_command", toolCallId: "tc1", status: "running", input: { command: "ls -la" } },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "run_command", toolCallId: "tc1", status: "completed" },
      }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.verificationSignals).toHaveLength(0);
  });

  it("detects file churn markers", () => {
    const records: TraceRecord[] = Array.from({ length: 4 }, () =>
      makeRecord("sess-1", "tool_call", {
        files: [{ path: "src/hot-file.ts", operation: "write" }],
      }),
    );

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.churnMarkers).toHaveLength(1);
    expect(digest.churnMarkers[0].target).toBe("src/hot-file.ts");
    expect(digest.churnMarkers[0].type).toBe("file");
    expect(digest.churnMarkers[0].count).toBe(4);
  });

  it("detects tool failure churn markers", () => {
    const records: TraceRecord[] = Array.from({ length: 4 }, (_, i) => [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "flaky_tool", toolCallId: `tc${i}`, status: "running" },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "flaky_tool", toolCallId: `tc${i}`, status: "failed", output: "fail" },
      }),
    ]).flat();

    const digest = buildTraceRunDigest("sess-1", records);
    const toolChurn = digest.churnMarkers.find((c) => c.type === "tool");
    expect(toolChurn).toBeDefined();
    expect(toolChurn!.target).toBe("flaky_tool");
    expect(toolChurn!.count).toBe(4);
  });

  it("flags missing tool results as confidence signal", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "read_file", toolCallId: "tc1", status: "running" },
      }),
      // No matching tool_result
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.confidenceFlags.length).toBeGreaterThan(0);
    expect(digest.confidenceFlags[0]).toContain("no matching result");
  });

  it("flags modified files without verification commands", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "write_file", toolCallId: "tc1", status: "running" },
        files: [{ path: "src/index.ts", operation: "write" }],
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "write_file", toolCallId: "tc1", status: "completed" },
      }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.confidenceFlags.some((f) => f.includes("no verification"))).toBe(true);
  });

  it("flags failed verification commands as confidence signal", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "run_command", toolCallId: "tc1", status: "running", input: { command: "npm test" } },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "run_command", toolCallId: "tc1", status: "failed", output: "Tests failed" },
      }),
    ];

    const digest = buildTraceRunDigest("sess-1", records);
    expect(digest.confidenceFlags.some((f) => f.includes("verification command(s) failed"))).toBe(true);
  });
});

describe("formatDigestForRole", () => {
  const baseRecords: TraceRecord[] = [
    makeRecord("sess-1", "tool_call", {
      timestamp: "2026-04-20T10:00:00Z",
      files: [
        { path: "src/index.ts", operation: "read" },
        { path: "src/utils.ts", operation: "write" },
      ],
      tool: { name: "read_file", toolCallId: "tc1", status: "running" },
    }),
    makeRecord("sess-1", "tool_result", {
      timestamp: "2026-04-20T10:01:00Z",
      tool: { name: "read_file", toolCallId: "tc1", status: "completed" },
    }),
    makeRecord("sess-1", "tool_result", {
      timestamp: "2026-04-20T10:02:00Z",
      tool: { name: "write_file", toolCallId: "tc2", status: "failed", output: "Permission denied" },
    }),
    makeRecord("sess-1", "agent_thought", {
      timestamp: "2026-04-20T10:03:00Z",
      conversation: { contentPreview: "Need to check file permissions" },
    }),
  ];

  it("returns empty string for empty digest", () => {
    const digest = buildTraceRunDigest("sess-1", []);
    expect(formatDigestForRole(digest, AgentRole.GATE)).toBe("");
  });

  it("GATE format includes all sections", () => {
    const digest = buildTraceRunDigest("sess-1", baseRecords);
    const formatted = formatDigestForRole(digest, AgentRole.GATE);

    expect(formatted).toContain("## Prior Run Context (Trace Digest)");
    expect(formatted).toContain("### Files Modified/Read");
    expect(formatted).toContain("`src/index.ts`");
    expect(formatted).toContain("`src/utils.ts`");
    expect(formatted).toContain("### Tool Usage");
    expect(formatted).toContain("read_file");
    expect(formatted).toContain("### Errors Encountered");
    expect(formatted).toContain("Permission denied");
    expect(formatted).toContain("### Key Agent Reasoning");
    expect(formatted).toContain("Need to check file permissions");
  });

  it("CRAFTER format excludes read-only files and tool usage details", () => {
    const digest = buildTraceRunDigest("sess-1", baseRecords);
    const formatted = formatDigestForRole(digest, AgentRole.CRAFTER);

    expect(formatted).toContain("## Prior Run Context (Trace Digest)");
    expect(formatted).toContain("### Files Changed");
    // CRAFTER only sees written files, not read-only
    expect(formatted).toContain("`src/utils.ts`");
    // CRAFTER does NOT get tool usage section
    expect(formatted).not.toContain("### Tool Usage");
    // CRAFTER gets error flags but not full summaries
    expect(formatted).toContain("### Error Flags");
    // CRAFTER does NOT get key thoughts
    expect(formatted).not.toContain("### Key Agent Reasoning");
  });

  it("GATE format shows read-only files too", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        files: [{ path: "README.md", operation: "read" }],
      }),
    ];
    const digest = buildTraceRunDigest("sess-1", records);

    const gateFormatted = formatDigestForRole(digest, AgentRole.GATE);
    expect(gateFormatted).toContain("`README.md`");

    const crafterFormatted = formatDigestForRole(digest, AgentRole.CRAFTER);
    // CRAFTER skips read-only files (no files section at all)
    expect(crafterFormatted).not.toContain("`README.md`");
  });

  it("GATE format shows verification evidence", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "run_command", toolCallId: "tc1", status: "running", input: { command: "npm test" } },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "run_command", toolCallId: "tc1", status: "completed" },
      }),
    ];
    const digest = buildTraceRunDigest("sess-1", records);
    const formatted = formatDigestForRole(digest, AgentRole.GATE);

    expect(formatted).toContain("### Verification Evidence");
    expect(formatted).toContain("✅ PASSED");
    expect(formatted).toContain("npm test");
  });

  it("GATE format shows missing verification warning", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        files: [{ path: "src/index.ts", operation: "write" }],
        tool: { name: "write_file", toolCallId: "tc1", status: "running" },
      }),
      makeRecord("sess-1", "tool_result", {
        tool: { name: "write_file", toolCallId: "tc1", status: "completed" },
      }),
    ];
    const digest = buildTraceRunDigest("sess-1", records);
    const formatted = formatDigestForRole(digest, AgentRole.GATE);

    expect(formatted).toContain("No verification commands detected");
  });

  it("GATE format shows suspicious gaps", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "read_file", toolCallId: "tc-orphan", status: "running" },
      }),
      // no result → orphan
    ];
    const digest = buildTraceRunDigest("sess-1", records);
    const formatted = formatDigestForRole(digest, AgentRole.GATE);

    expect(formatted).toContain("### Suspicious Gaps");
    expect(formatted).toContain("no matching result");
  });

  it("CRAFTER format shows churn risk prominently", () => {
    const records: TraceRecord[] = Array.from({ length: 4 }, () =>
      makeRecord("sess-1", "tool_call", {
        files: [{ path: "src/hot.ts", operation: "write" }],
      }),
    );
    const digest = buildTraceRunDigest("sess-1", records);
    const formatted = formatDigestForRole(digest, AgentRole.CRAFTER);

    expect(formatted).toContain("### High-Risk Areas (Repeated Churn)");
    expect(formatted).toContain("`src/hot.ts`");
  });

  it("CRAFTER format shows risk signal count", () => {
    const records: TraceRecord[] = [
      makeRecord("sess-1", "tool_call", {
        tool: { name: "read_file", toolCallId: "tc-orphan", status: "running" },
      }),
    ];
    const digest = buildTraceRunDigest("sess-1", records);
    const formatted = formatDigestForRole(digest, AgentRole.CRAFTER);

    expect(formatted).toContain("### Risk Signals");
    expect(formatted).toContain("confidence-reducing signal(s) detected");
  });
});
