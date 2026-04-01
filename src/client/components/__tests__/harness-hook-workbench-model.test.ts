import { describe, expect, it } from "vitest";
import type { HooksResponse } from "@/client/hooks/use-harness-settings-data";
import {
  buildHookFlow,
  buildHookWorkbenchEntries,
  buildRuntimeProfileSource,
  getDefaultWorkbenchHook,
} from "../harness-hook-workbench-model";

function createHooksResponse(): HooksResponse {
  return {
    generatedAt: "2026-03-29T00:00:00.000Z",
    repoRoot: "/tmp/routa-js",
    hooksDir: "/tmp/routa-js/.husky",
    configFile: {
      relativePath: "docs/fitness/runtime/hooks.yaml",
      source: "schema: hook-runtime-v1",
      schema: "hook-runtime-v1",
    },
    reviewTriggerFile: {
      relativePath: "docs/fitness/review-triggers.yaml",
      source: "review_triggers: []",
      ruleCount: 0,
      rules: [],
    },
    hookFiles: [
      {
        name: "pre-commit",
        relativePath: ".husky/pre-commit",
        source: "node --import tsx tools/hook-runtime/src/cli.ts --profile pre-commit \"$@\"",
        triggerCommand: "node --import tsx tools/hook-runtime/src/cli.ts --profile pre-commit \"$@\"",
        kind: "runtime-profile",
        runtimeProfileName: "pre-commit",
        skipEnvVar: "SKIP_HOOKS",
      },
      {
        name: "post-commit",
        relativePath: ".husky/post-commit",
        source: "python3 -m entrix hook file-length",
        triggerCommand: "python3 -m entrix hook file-length",
        kind: "shell-command",
        skipEnvVar: "SKIP_HOOKS",
      },
      {
        name: "pre-push",
        relativePath: ".husky/pre-push",
        source: "node --import tsx tools/hook-runtime/src/cli.ts --profile pre-push \"$@\"",
        triggerCommand: "node --import tsx tools/hook-runtime/src/cli.ts --profile pre-push \"$@\"",
        kind: "runtime-profile",
        runtimeProfileName: "pre-push",
        skipEnvVar: "SKIP_HOOKS",
      },
    ],
    profiles: [
      {
        name: "pre-commit",
        phases: ["fitness-fast"],
        fallbackMetrics: ["eslint_pass"],
        hooks: ["pre-commit"],
        metrics: [
          {
            name: "eslint_pass",
            command: "npx eslint .",
            description: "Run ESLint",
            hardGate: true,
            resolved: true,
            sourceFile: "docs/fitness/typescript.md",
          },
        ],
      },
      {
        name: "pre-push",
        phases: ["submodule", "fitness", "review"],
        fallbackMetrics: ["ts_test_pass"],
        hooks: ["pre-push"],
        metrics: [
          {
            name: "ts_test_pass",
            command: "npx vitest run",
            description: "Run TS tests",
            hardGate: true,
            resolved: true,
            sourceFile: "docs/fitness/unit-test.md",
          },
        ],
      },
    ],
    releaseTriggerFile: null,
    warnings: [],
  };
}

describe("harness-hook-workbench-model", () => {
  it("maps current hook data into lifecycle-aware workbench entries", () => {
    const entries = buildHookWorkbenchEntries(createHooksResponse());
    const defaultEntry = getDefaultWorkbenchHook(entries);
    const preCommit = entries.find((entry) => entry.name === "pre-commit");
    const preReceive = entries.find((entry) => entry.name === "pre-receive");
    const postCommit = entries.find((entry) => entry.name === "post-commit");

    expect(defaultEntry?.name).toBe("pre-commit");
    expect(preCommit).toMatchObject({
      lifecycleGroup: "commit",
      channelLabel: "Local",
      blockingLabel: "Blocking",
      bypassabilityLabel: "Bypassable",
      enabled: true,
      mode: "runtime-profile",
    });
    expect(preCommit?.envKeys).toContain("SKIP_HOOKS");
    expect(preCommit?.tasks).toHaveLength(1);

    expect(preReceive).toMatchObject({
      lifecycleGroup: "receive",
      channelLabel: "Remote",
      enabled: false,
      configured: false,
      stdinTemplate: "<old-sha> <new-sha> <ref-name>",
    });

    expect(postCommit).toMatchObject({
      blocking: false,
      mode: "shell-command",
    });
  });

  it("builds a hook flow graph and runtime profile source", () => {
    const entries = buildHookWorkbenchEntries(createHooksResponse());
    const prePush = entries.find((entry) => entry.name === "pre-push");

    expect(prePush).not.toBeNull();
    const flow = buildHookFlow(prePush!);
    const runtimeSource = buildRuntimeProfileSource(prePush!);

    expect(flow.nodes.map((node) => node.kind)).toEqual(["hook", "task", "result", "result"]);
    expect(flow.edges).toHaveLength(3);
    expect(runtimeSource).toContain("profile: pre-push");
    expect(runtimeSource).toContain("  - review");
    expect(runtimeSource).toContain("  - ts_test_pass");
  });
});
