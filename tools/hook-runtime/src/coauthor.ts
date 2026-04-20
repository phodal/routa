#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

export type CoauthorMode = "prepare" | "validate";

export type CoauthorEnv = Record<string, string | undefined>;

type AgentIdentity = {
  displayName: string;
  email: string;
  trailer: string;
};

type CoauthorResult =
  | { status: "skipped"; reason: string }
  | { status: "updated"; trailer: string }
  | { status: "ok"; trailer: string }
  | { status: "failed"; reason: string };

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const COAUTHOR_PREFIX_RE = /^Co-authored-by:/i;

export function isAgentCoauthorEnforced(env: CoauthorEnv): boolean {
  const explicit = env.ROUTA_COAUTHOR_ENFORCE?.trim().toLowerCase();
  if (explicit && TRUTHY.has(explicit)) {
    return true;
  }

  return Boolean(
    env.ROUTA_COAUTHOR_NAME?.trim()
      || env.ROUTA_COAUTHOR_EMAIL?.trim()
      || env.ROUTA_AGENT_NAME?.trim()
      || env.ROUTA_AGENT_MODEL?.trim(),
  );
}

export function resolveAgentIdentity(env: CoauthorEnv): AgentIdentity | null {
  const email = env.ROUTA_COAUTHOR_EMAIL?.trim();
  const explicitName = env.ROUTA_COAUTHOR_NAME?.trim();
  const agentName = env.ROUTA_AGENT_NAME?.trim();
  const agentModel = env.ROUTA_AGENT_MODEL?.trim();

  let displayName = explicitName ?? "";
  if (!displayName && agentName && agentModel) {
    displayName = `${agentName} (${agentModel})`;
  } else if (!displayName && agentName) {
    displayName = agentName;
  }

  if (!displayName || !email) {
    return null;
  }

  return {
    displayName,
    email,
    trailer: `Co-authored-by: ${displayName} <${email}>`,
  };
}

export function messageHasTrailer(message: string, trailer: string): boolean {
  return message
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase() === trailer.trim().toLowerCase());
}

function listCoauthorTrailers(message: string): string[] {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => COAUTHOR_PREFIX_RE.test(line));
}

function appendTrailer(message: string, trailer: string): string {
  const trimmedEnd = message.replace(/\s*$/u, "");
  const separator = trimmedEnd.length === 0 ? "" : "\n\n";
  return `${trimmedEnd}${separator}${trailer}\n`;
}

export function runCoauthorMode(
  mode: CoauthorMode,
  messageFile: string,
  env: CoauthorEnv = process.env,
): CoauthorResult {
  if (!isAgentCoauthorEnforced(env)) {
    return {
      status: "skipped",
      reason: "Agent co-author enforcement is not active for this commit.",
    };
  }

  const identity = resolveAgentIdentity(env);
  if (!identity) {
    return {
      status: "failed",
      reason:
        "Agent co-author enforcement is active, but identity is incomplete. Set ROUTA_COAUTHOR_EMAIL plus ROUTA_COAUTHOR_NAME, or set ROUTA_AGENT_NAME and ROUTA_AGENT_MODEL.",
    };
  }

  const commitMessage = fs.readFileSync(messageFile, "utf8");
  const coauthorTrailers = listCoauthorTrailers(commitMessage);
  const hasExpectedTrailer = coauthorTrailers.some((line) => (
    line.toLowerCase() === identity.trailer.toLowerCase()
  ));

  if (mode === "prepare") {
    if (coauthorTrailers.length === 0) {
      fs.writeFileSync(messageFile, appendTrailer(commitMessage, identity.trailer), "utf8");
      return { status: "updated", trailer: identity.trailer };
    }

    return { status: "ok", trailer: identity.trailer };
  }

  if (coauthorTrailers.length === 0) {
    return {
      status: "failed",
      reason:
        `Commit message must include exactly one Co-authored-by trailer. Expected: ${identity.trailer}`,
    };
  }

  if (coauthorTrailers.length > 1) {
    return {
      status: "failed",
      reason:
        `Commit message must contain exactly one Co-authored-by trailer, but found ${coauthorTrailers.length}. Keep a single aggregated trailer and remove extras.`,
    };
  }

  if (!hasExpectedTrailer) {
    return {
      status: "failed",
      reason:
        `Commit message has a Co-authored-by trailer, but it does not match the active agent identity. Expected: ${identity.trailer}. Found: ${coauthorTrailers[0]}`,
    };
  }

  return { status: "ok", trailer: identity.trailer };
}

function printFailureAndExit(reason: string): never {
  console.error("❌ COMMIT BLOCKED: Co-author trailer policy violated");
  console.error("");
  console.error(`   ${reason}`);
  console.error("");
  console.error("   Commit messages for agent-authored changes must contain exactly one");
  console.error("   Co-authored-by trailer for the active agent.");
  console.error("   If multiple agents contributed, aggregate them into one entry per AGENTS.md.");
  console.error("");
  console.error("   Required environment for agent commits:");
  console.error("   - ROUTA_COAUTHOR_EMAIL");
  console.error("   - ROUTA_COAUTHOR_NAME");
  console.error("   or");
  console.error("   - ROUTA_AGENT_NAME");
  console.error("   - ROUTA_AGENT_MODEL");
  process.exit(1);
}

function main(): void {
  const [, , rawMode, rawMessageFile] = process.argv;
  const mode = rawMode as CoauthorMode | undefined;

  if (!mode || (mode !== "prepare" && mode !== "validate")) {
    console.error("Usage: node --import tsx tools/hook-runtime/src/coauthor.ts <prepare|validate> <commit-msg-file>");
    process.exit(1);
  }

  if (!rawMessageFile) {
    console.error("Missing commit message file path.");
    process.exit(1);
  }

  const messageFile = path.resolve(rawMessageFile);
  const result = runCoauthorMode(mode, messageFile, process.env);

  if (result.status === "failed") {
    printFailureAndExit(result.reason);
  }
}

const basename = path.basename(process.argv[1] ?? "");
if (basename === "coauthor.ts") {
  main();
}
