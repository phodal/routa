import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../process.js", () => ({
  runCommand: runCommandMock,
  tailOutput: (output: string, maxChars = 6000) => (
    output.length <= maxChars ? output : output.slice(-maxChars)
  ),
}));

import { runReviewTriggerSpecialist } from "../specialist-review.js";

describe("runReviewTriggerSpecialist", () => {
  const originalReviewProvider = process.env.ROUTA_REVIEW_PROVIDER;
  const originalReviewFallbackProvider = process.env.ROUTA_REVIEW_FALLBACK_PROVIDER;
  const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    if (originalReviewProvider === undefined) {
      delete process.env.ROUTA_REVIEW_PROVIDER;
    } else {
      process.env.ROUTA_REVIEW_PROVIDER = originalReviewProvider;
    }

    if (originalReviewFallbackProvider === undefined) {
      delete process.env.ROUTA_REVIEW_FALLBACK_PROVIDER;
    } else {
      process.env.ROUTA_REVIEW_FALLBACK_PROVIDER = originalReviewFallbackProvider;
    }

    if (originalAnthropicAuthToken === undefined) {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_AUTH_TOKEN = originalAnthropicAuthToken;
    }

    if (originalAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }

    global.fetch = originalFetch;
  });

  it("uses Claude CLI when the specialist default adapter is claude-code-sdk", async () => {
    delete process.env.ROUTA_REVIEW_PROVIDER;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    runCommandMock
      .mockResolvedValueOnce({
        command: "git diff --stat 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: " tools/hook-runtime/src/specialist-review.ts | 10 +++++-----\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --unified=3 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: "diff --git a/file b/file\n+change\n",
      })
      .mockResolvedValueOnce({
        command: "printf ... | claude -p --permission-mode bypassPermissions",
        durationMs: 5,
        exitCode: 0,
        output: "{\"verdict\":\"pass\",\"summary\":\"looks safe\",\"findings\":[]}",
      });

    const result = await runReviewTriggerSpecialist({
      reviewRoot: process.cwd(),
      base: "origin/main",
      report: {
        triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
        committed_files: ["tools/hook-runtime/src/specialist-review.ts"],
      },
    });

    expect(result.allowed).toBe(true);
    expect(runCommandMock).toHaveBeenCalledTimes(3);
    expect(runCommandMock.mock.calls[2]?.[0]).toContain("claude -p --permission-mode bypassPermissions");
    expect(runCommandMock.mock.calls[2]?.[1]).toMatchObject({ timeoutMs: 45_000 });
  });

  it("uses anthropic-compatible HTTP when provider override is anthropic", async () => {
    process.env.ROUTA_REVIEW_PROVIDER = "anthropic";
    process.env.ANTHROPIC_AUTH_TOKEN = "test-token";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        content: [{ type: "text", text: "{\"verdict\":\"pass\",\"summary\":\"ok\",\"findings\":[]}" }],
      }),
    }) as unknown as typeof fetch;

    runCommandMock
      .mockResolvedValueOnce({
        command: "git diff --stat 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: " tools/hook-runtime/src/specialist-review.ts | 10 +++++-----\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --unified=3 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: "diff --git a/file b/file\n+change\n",
      });

    const result = await runReviewTriggerSpecialist({
      reviewRoot: process.cwd(),
      base: "origin/main",
      report: {
        triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
        committed_files: ["tools/hook-runtime/src/specialist-review.ts"],
      },
    });

    expect(result.allowed).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses Codex CLI when provider override is codex", async () => {
    process.env.ROUTA_REVIEW_PROVIDER = "codex";

    runCommandMock
      .mockResolvedValueOnce({
        command: "git diff --stat 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: " tools/hook-runtime/src/specialist-review.ts | 10 +++++-----\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --unified=3 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: "diff --git a/file b/file\n+change\n",
      })
      .mockImplementationOnce(async (command: string) => {
        const match = command.match(/--output-last-message '([^']+)'/);
        if (!match?.[1]) {
          throw new Error(`Missing output file in command: ${command}`);
        }
        fs.writeFileSync(match[1], "{\"verdict\":\"pass\",\"summary\":\"codex ok\",\"findings\":[]}");
        return {
          command,
          durationMs: 5,
          exitCode: 0,
          output: "",
        };
      });

    const result = await runReviewTriggerSpecialist({
      reviewRoot: process.cwd(),
      base: "origin/main",
      report: {
        triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
        committed_files: ["tools/hook-runtime/src/specialist-review.ts"],
      },
    });

    expect(result.allowed).toBe(true);
    expect(runCommandMock).toHaveBeenCalledTimes(3);
    expect(runCommandMock.mock.calls[2]?.[0]).toContain("codex -a never exec -s read-only");
    expect(runCommandMock.mock.calls[2]?.[1]).toMatchObject({ timeoutMs: 45_000 });
  });

  it("falls back to Codex when the default Claude provider is unavailable", async () => {
    delete process.env.ROUTA_REVIEW_PROVIDER;
    delete process.env.ROUTA_REVIEW_FALLBACK_PROVIDER;

    runCommandMock
      .mockResolvedValueOnce({
        command: "git diff --stat 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: " tools/hook-runtime/src/specialist-review.ts | 10 +++++-----\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --unified=3 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: "diff --git a/file b/file\n+change\n",
      })
      .mockResolvedValueOnce({
        command: "printf ... | claude -p --permission-mode bypassPermissions",
        durationMs: 5,
        exitCode: 1,
        output: "Credit balance is too low",
      })
      .mockImplementationOnce(async (command: string) => {
        const match = command.match(/--output-last-message '([^']+)'/);
        if (!match?.[1]) {
          throw new Error(`Missing output file in command: ${command}`);
        }
        fs.writeFileSync(match[1], "{\"verdict\":\"pass\",\"summary\":\"fallback ok\",\"findings\":[]}");
        return {
          command,
          durationMs: 5,
          exitCode: 0,
          output: "",
        };
      });

    const result = await runReviewTriggerSpecialist({
      reviewRoot: process.cwd(),
      base: "origin/main",
      report: {
        triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
        committed_files: ["tools/hook-runtime/src/specialist-review.ts"],
      },
    });

    expect(result.allowed).toBe(true);
    expect(runCommandMock).toHaveBeenCalledTimes(4);
    expect(runCommandMock.mock.calls[2]?.[0]).toContain("claude -p --permission-mode bypassPermissions");
    expect(runCommandMock.mock.calls[3]?.[0]).toContain("codex -a never exec -s read-only");
  });

  it("falls back to Codex when the default Claude provider returns an empty verdict", async () => {
    delete process.env.ROUTA_REVIEW_PROVIDER;
    delete process.env.ROUTA_REVIEW_FALLBACK_PROVIDER;

    runCommandMock
      .mockResolvedValueOnce({
        command: "git diff --stat 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: " tools/hook-runtime/src/specialist-review.ts | 10 +++++-----\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --unified=3 'origin/main...HEAD'",
        durationMs: 5,
        exitCode: 0,
        output: "diff --git a/file b/file\n+change\n",
      })
      .mockResolvedValueOnce({
        command: "printf ... | claude -p --permission-mode bypassPermissions",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockImplementationOnce(async (command: string) => {
        const match = command.match(/--output-last-message '([^']+)'/);
        if (!match?.[1]) {
          throw new Error(`Missing output file in command: ${command}`);
        }
        fs.writeFileSync(match[1], "{\"verdict\":\"pass\",\"summary\":\"fallback after empty verdict\",\"findings\":[]}");
        return {
          command,
          durationMs: 5,
          exitCode: 0,
          output: "",
        };
      });

    const result = await runReviewTriggerSpecialist({
      reviewRoot: process.cwd(),
      base: "origin/main",
      report: {
        triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
        committed_files: ["tools/hook-runtime/src/specialist-review.ts"],
      },
    });

    expect(result.allowed).toBe(true);
    expect(runCommandMock).toHaveBeenCalledTimes(4);
    expect(runCommandMock.mock.calls[2]?.[0]).toContain("claude -p --permission-mode bypassPermissions");
    expect(runCommandMock.mock.calls[3]?.[0]).toContain("codex -a never exec -s read-only");
  });
});
