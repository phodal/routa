import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isAgentCoauthorEnforced,
  messageHasTrailer,
  resolveAgentIdentity,
  runCoauthorMode,
} from "../coauthor.js";

describe("coauthor hook runtime", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore cleanup failures on temp files
      }
    }
  });

  function writeMessage(contents: string): string {
    const file = path.join(os.tmpdir(), `routa-coauthor-${Date.now()}-${Math.random()}.txt`);
    fs.writeFileSync(file, contents, "utf8");
    tempFiles.push(file);
    return file;
  }

  it("detects explicit enforcement via env", () => {
    expect(isAgentCoauthorEnforced({ ROUTA_COAUTHOR_ENFORCE: "1" })).toBe(true);
    expect(isAgentCoauthorEnforced({})).toBe(false);
  });

  it("builds the trailer from agent name and model when explicit coauthor name is absent", () => {
    expect(
      resolveAgentIdentity({
        ROUTA_AGENT_NAME: "Codex",
        ROUTA_AGENT_MODEL: "GPT-5",
        ROUTA_COAUTHOR_EMAIL: "codex@example.test",
      }),
    ).toEqual({
      displayName: "Codex (GPT-5)",
      email: "codex@example.test",
      trailer: "Co-authored-by: Codex (GPT-5) <codex@example.test>",
    });
  });

  it("appends the required trailer during prepare mode", () => {
    const file = writeMessage("feat(test): add hook coverage\n");
    const result = runCoauthorMode("prepare", file, {
      ROUTA_AGENT_NAME: "Codex",
      ROUTA_AGENT_MODEL: "GPT-5",
      ROUTA_COAUTHOR_EMAIL: "codex@example.test",
    });

    expect(result).toEqual({
      status: "updated",
      trailer: "Co-authored-by: Codex (GPT-5) <codex@example.test>",
    });
    expect(
      messageHasTrailer(
        fs.readFileSync(file, "utf8"),
        "Co-authored-by: Codex (GPT-5) <codex@example.test>",
      ),
    ).toBe(true);
  });

  it("fails validation when an enforced agent commit is missing the expected trailer", () => {
    const file = writeMessage("feat(test): add hook coverage\n");
    const result = runCoauthorMode("validate", file, {
      ROUTA_AGENT_NAME: "Codex",
      ROUTA_AGENT_MODEL: "GPT-5",
      ROUTA_COAUTHOR_EMAIL: "codex@example.test",
    });

    expect(result).toEqual({
      status: "failed",
      reason:
        "Commit message must include exactly one Co-authored-by trailer. Expected: Co-authored-by: Codex (GPT-5) <codex@example.test>",
    });
  });

  it("does not append another trailer during prepare mode when one already exists", () => {
    const file = writeMessage(
      "feat(test): add hook coverage\n\nCo-authored-by: Someone Else (GPT-X) <else@example.test>\n",
    );
    const result = runCoauthorMode("prepare", file, {
      ROUTA_AGENT_NAME: "Codex",
      ROUTA_AGENT_MODEL: "GPT-5",
      ROUTA_COAUTHOR_EMAIL: "codex@example.test",
    });

    expect(result).toEqual({
      status: "ok",
      trailer: "Co-authored-by: Codex (GPT-5) <codex@example.test>",
    });
    expect(fs.readFileSync(file, "utf8")).toBe(
      "feat(test): add hook coverage\n\nCo-authored-by: Someone Else (GPT-X) <else@example.test>\n",
    );
  });

  it("fails validation when multiple co-author trailers are present", () => {
    const file = writeMessage(
      [
        "feat(test): add hook coverage",
        "",
        "Co-authored-by: Codex (GPT-5) <codex@example.test>",
        "Co-authored-by: Someone Else (GPT-X) <else@example.test>",
        "",
      ].join("\n"),
    );
    const result = runCoauthorMode("validate", file, {
      ROUTA_AGENT_NAME: "Codex",
      ROUTA_AGENT_MODEL: "GPT-5",
      ROUTA_COAUTHOR_EMAIL: "codex@example.test",
    });

    expect(result).toEqual({
      status: "failed",
      reason:
        "Commit message must contain exactly one Co-authored-by trailer, but found 2. Keep a single aggregated trailer and remove extras.",
    });
  });

  it("fails validation when the only trailer does not match the active agent identity", () => {
    const file = writeMessage(
      "feat(test): add hook coverage\n\nCo-authored-by: Someone Else (GPT-X) <else@example.test>\n",
    );
    const result = runCoauthorMode("validate", file, {
      ROUTA_AGENT_NAME: "Codex",
      ROUTA_AGENT_MODEL: "GPT-5",
      ROUTA_COAUTHOR_EMAIL: "codex@example.test",
    });

    expect(result).toEqual({
      status: "failed",
      reason:
        "Commit message has a Co-authored-by trailer, but it does not match the active agent identity. Expected: Co-authored-by: Codex (GPT-5) <codex@example.test>. Found: Co-authored-by: Someone Else (GPT-X) <else@example.test>",
    });
  });

  it("skips human-only commits", () => {
    const file = writeMessage("feat(test): human commit\n");
    const result = runCoauthorMode("validate", file, {});

    expect(result).toEqual({
      status: "skipped",
      reason: "Agent co-author enforcement is not active for this commit.",
    });
  });
});
