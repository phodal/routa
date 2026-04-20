/**
 * Agent Trace Module
 *
 * Provides tracing capabilities for agent sessions, recording:
 * - Session lifecycle (start/end)
 * - User messages
 * - Agent responses (messages, thoughts)
 * - Tool calls and results
 * - File modifications
 * - VCS context (Git revision, branch, repo root)
 */

export * from "./types";
export * from "./writer";
export * from "./reader";
export * from "./session-query";
export * from "./file-range-extractor";
export * from "./vcs-context";
export * from "./trace-run-digest";
