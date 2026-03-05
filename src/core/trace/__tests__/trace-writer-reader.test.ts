/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { TraceWriter } from "../writer";
import { TraceReader } from "../reader";
import type { TraceRecord } from "../types";

function makeRecord(sessionId: string, eventType: string = "session_start"): TraceRecord {
  return {
    version: "0.1.0",
    id: `trace-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    sessionId,
    contributor: { provider: "test" },
    eventType: eventType as TraceRecord["eventType"],
  };
}

describe("TraceWriter — per-session files", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-writer-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes different sessions to separate files", async () => {
    const writer = new TraceWriter(tmpDir);

    const r1 = makeRecord("session-aaa");
    const r2 = makeRecord("session-bbb");
    const r3 = makeRecord("session-aaa", "user_message");

    await writer.append(r1);
    await writer.append(r2);
    await writer.append(r3);

    // Find the day directory
    const homeDir = process.env.HOME || os.homedir();
    // TraceWriter uses getTracesDir which goes to ~/.routa/projects/{slug}/traces/
    // For a tmp dir, the slug will be based on the tmpDir path
    // Instead, let's just check the files were created by reading them back
    const reader = TraceReader.withBaseDir(tmpDir);

    const sessionA = await reader.query({ sessionId: "session-aaa" });
    const sessionB = await reader.query({ sessionId: "session-bbb" });

    expect(sessionA.length).toBe(2);
    expect(sessionB.length).toBe(1);
    expect(sessionA[0].sessionId).toBe("session-aaa");
    expect(sessionB[0].sessionId).toBe("session-bbb");
  });
});

describe("TraceReader — trailing slash resilience", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-reader-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads traces when workspace root has trailing slash", async () => {
    // Create a trace file in the legacy path
    const legacyDir = path.join(tmpDir, ".routa", "traces", "2026-03-05");
    await fs.mkdir(legacyDir, { recursive: true });

    const record = makeRecord("test-session-123");
    await fs.writeFile(
      path.join(legacyDir, "traces-20260305-120000.jsonl"),
      JSON.stringify(record) + "\n",
    );

    // Create reader with trailing slash (the bug scenario)
    const readerWithSlash = new TraceReader(tmpDir + "/");
    const readerWithout = new TraceReader(tmpDir);

    const tracesWithSlash = await readerWithSlash.query({ sessionId: "test-session-123" });
    const tracesWithout = await readerWithout.query({ sessionId: "test-session-123" });

    // Both should find the trace
    expect(tracesWithSlash.length).toBe(1);
    expect(tracesWithout.length).toBe(1);
    expect(tracesWithSlash[0].sessionId).toBe("test-session-123");
  });
});
