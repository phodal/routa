/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ToolCallContextWriter } from "../tool-call-context-writer";

let tmpDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-call-context-test-"));
  // Override HOME so getSessionsDir uses our temp dir
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

describe("ToolCallContextWriter", () => {
  it("writes content.txt and metadata.json for a tool call", async () => {
    const writer = new ToolCallContextWriter("/test/project");
    const paths = writer.getContextPaths("sess-1", "call_abc123xyz");

    expect(paths.resourceId).toContain("call_call_abc");
    // Use path.sep for cross-platform compatibility (Windows uses \, Unix uses /)
    expect(paths.contentPath).toContain(`${path.sep}content.txt`);
    expect(paths.metadataPath).toContain(`${path.sep}metadata.json`);

    await writer.writeContext({
      toolName: "read_file",
      toolCallId: "call_abc123xyz",
      sessionId: "sess-1",
      provider: "claude",
      status: "running",
      input: { path: "/src/main.ts" },
    });

    // Find the created directory
    const sessionsDir = path.join(
      tmpDir,
      ".routa/projects/test-project/sessions/sess-1/tool-calls/call_abc123xyz"
    );
    const entries = await fs.readdir(sessionsDir);
    expect(entries).toHaveLength(1);

    const resourceDir = path.join(sessionsDir, entries[0]);
    const contentPath = path.join(resourceDir, "content.txt");
    const metadataPath = path.join(resourceDir, "metadata.json");

    // Check content.txt
    const content = await fs.readFile(contentPath, "utf-8");
    expect(content).toContain("Tool Call: read_file");
    expect(content).toContain("Session: sess-1");
    expect(content).toContain("ToolCallId: call_abc123xyz");
    expect(content).toContain("Status: running");
    expect(content).toContain('"path": "/src/main.ts"');

    // Check metadata.json
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf-8"));
    expect(metadata.toolName).toBe("read_file");
    expect(metadata.toolCallId).toBe("call_abc123xyz");
    expect(metadata.sessionId).toBe("sess-1");
    expect(metadata.provider).toBe("claude");
    expect(metadata.status).toBe("running");
  });

  it("writes output when tool completes", async () => {
    const writer = new ToolCallContextWriter("/test/project");

    // First write running state
    await writer.writeContext({
      toolName: "read_file",
      toolCallId: "call_def456",
      sessionId: "sess-2",
      provider: "claude",
      status: "running",
      input: { path: "/src/app.ts" },
    });

    // Then write completed state with output
    await writer.writeContext({
      toolName: "read_file",
      toolCallId: "call_def456",
      sessionId: "sess-2",
      provider: "claude",
      status: "completed",
      input: { path: "/src/app.ts" },
      output: { content: "console.log('Hello');", size: 23 },
    });

    // Find the created directory
    const sessionsDir = path.join(
      tmpDir,
      ".routa/projects/test-project/sessions/sess-2/tool-calls/call_def456"
    );
    const entries = await fs.readdir(sessionsDir);
    expect(entries).toHaveLength(1);

    const resourceDir = path.join(sessionsDir, entries[0]);
    const content = await fs.readFile(
      path.join(resourceDir, "content.txt"),
      "utf-8"
    );
    expect(content).toContain("Status: completed");
    expect(content).toContain("Output:");
    expect(content).toContain("console.log('Hello');");

    const metadata = JSON.parse(
      await fs.readFile(path.join(resourceDir, "metadata.json"), "utf-8")
    );
    expect(metadata.status).toBe("completed");
    expect(metadata.durationMs).toBeDefined();
    expect(metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("generates consistent resource ID for same tool call", async () => {
    const writer = new ToolCallContextWriter("/test/project");
    const toolCallId = "call_consistent123";
    const beforeWrite = writer.getContextPaths("sess-3", toolCallId);

    await writer.writeContext({
      toolName: "write_file",
      toolCallId,
      sessionId: "sess-3",
      provider: "opencode",
      status: "running",
      input: { path: "/test.txt", content: "hello" },
    });

    await writer.writeContext({
      toolName: "write_file",
      toolCallId,
      sessionId: "sess-3",
      provider: "opencode",
      status: "completed",
      input: { path: "/test.txt", content: "hello" },
      output: { success: true },
    });

    // Should only have one resource directory (same ID reused)
    const sessionsDir = path.join(
      tmpDir,
      ".routa/projects/test-project/sessions/sess-3/tool-calls",
      toolCallId
    );
    const entries = await fs.readdir(sessionsDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe(beforeWrite.resourceId);
  });

  it("truncates very long output", async () => {
    const writer = new ToolCallContextWriter("/test/project");
    const longOutput = "x".repeat(60000);

    await writer.writeContext({
      toolName: "read_file",
      toolCallId: "call_long_output",
      sessionId: "sess-4",
      provider: "claude",
      status: "completed",
      output: longOutput,
    });

    const sessionsDir = path.join(
      tmpDir,
      ".routa/projects/test-project/sessions/sess-4/tool-calls/call_long_output"
    );
    const entries = await fs.readdir(sessionsDir);
    const resourceDir = path.join(sessionsDir, entries[0]);
    const content = await fs.readFile(
      path.join(resourceDir, "content.txt"),
      "utf-8"
    );

    expect(content).toContain("... (truncated)");
    expect(content.length).toBeLessThan(55000);
  });
});
