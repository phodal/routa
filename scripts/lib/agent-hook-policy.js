import path from "node:path";

export const CONTROL_PLANE_BYPASS_ENV = "ROUTA_ALLOW_CONTROL_PLANE_MUTATION";

const PATH_KEY_PATTERN = /(path|file|target|source|destination|root|cwd)/i;

const PROTECTED_PATH_RULES = [
  { label: ".git/config", pattern: /^\.git\/config$/ },
  { label: ".git/hooks", pattern: /^\.git\/hooks(?:\/|$)/ },
  { label: ".husky", pattern: /^\.husky(?:\/|$)/ },
  { label: ".codex/hooks.json", pattern: /^\.codex\/hooks\.json$/ },
  { label: ".claude/settings.json", pattern: /^\.claude\/settings\.json$/ },
  { label: ".claude/settings.local.json", pattern: /^\.claude\/settings\.local\.json$/ },
  { label: ".qoder/settings.json", pattern: /^\.qoder\/settings\.json$/ },
  { label: "docs/fitness/runtime/agent-hooks.yaml", pattern: /^docs\/fitness\/runtime\/agent-hooks\.yaml$/ },
  { label: "scripts/check-tool-permission.js", pattern: /^scripts\/check-tool-permission\.js$/ },
  { label: "scripts/check-prompt-policy.js", pattern: /^scripts\/check-prompt-policy\.js$/ },
  { label: "scripts/check-git-control-plane.js", pattern: /^scripts\/check-git-control-plane\.js$/ },
  { label: "scripts/lib/agent-hook-policy.js", pattern: /^scripts\/lib\/agent-hook-policy\.js$/ },
  { label: "scripts/lib/git-control-plane-doctor.js", pattern: /^scripts\/lib\/git-control-plane-doctor\.js$/ },
  { label: "tools/hook-runtime/src/install.ts", pattern: /^tools\/hook-runtime\/src\/install\.ts$/ },
];

const PROTECTED_GIT_KEYS = ["core.hooksPath", "core.worktree", "user.name", "user.email"];

const SHELL_MUTATION_PATTERNS = [
  {
    reason:
      "Direct git config mutations for core.hooksPath, core.worktree, or commit identity are blocked. Use `npm run hooks:sync` for hook repair, or set ROUTA_ALLOW_CONTROL_PLANE_MUTATION=1 for an intentional override.",
    test(command) {
      return detectGitConfigMutation(command);
    },
  },
  {
    reason:
      "Protected control-plane files cannot be changed through shell mutations by default. Set ROUTA_ALLOW_CONTROL_PLANE_MUTATION=1 for an intentional override.",
    test(command) {
      return detectProtectedPathShellMutation(command);
    },
  },
];

const PROMPT_MUTATION_PATTERNS = [
  /\bgit\s+config\b[^\n\r]*(?:core\.(?:hooksPath|worktree)|user\.(?:name|email))/i,
  /(?:^|[\s`])(?:echo|printf|tee|cp|mv|rm|touch|chmod|chown|install)\b[^\n\r]*(?:\.git\/config|\.git\/hooks(?:\/|$)|\.husky(?:\/|$)|\.codex\/hooks\.json|\.claude\/settings(?:\.local)?\.json|\.qoder\/settings\.json)/i,
  /\b(?:sed|perl)\b[^\n\r]*\s-i(?:\S*)?[^\n\r]*(?:\.git\/config|\.git\/hooks(?:\/|$)|\.husky(?:\/|$)|\.codex\/hooks\.json|\.claude\/settings(?:\.local)?\.json|\.qoder\/settings\.json)/i,
];

function normalizePathSlashes(value) {
  return value.replace(/\\/g, "/");
}

function stripWrappingQuotes(value) {
  return value.replace(/^['"]+|['"]+$/g, "");
}

export function safeParseJson(raw) {
  if (!raw || !raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isControlPlaneBypassEnabled(env = process.env) {
  return env[CONTROL_PLANE_BYPASS_ENV] === "1";
}

export function formatHookBlockOutput(reason) {
  return JSON.stringify({
    decision: "block",
    reason,
  });
}

function toRepoRelativePath(candidate, cwd) {
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = stripWrappingQuotes(candidate.trim());
  if (!trimmed) {
    return null;
  }

  const normalized = normalizePathSlashes(trimmed);
  if (path.isAbsolute(trimmed)) {
    const relative = normalizePathSlashes(path.relative(cwd, trimmed));
    if (!relative || relative === "") {
      return ".";
    }
    return relative;
  }

  return path.posix.normalize(normalized);
}

export function getProtectedPathLabel(candidate, cwd = process.cwd()) {
  const relative = toRepoRelativePath(candidate, cwd);
  if (!relative) {
    return null;
  }

  const matched = PROTECTED_PATH_RULES.find((rule) => rule.pattern.test(relative));
  return matched ? matched.label : null;
}

function collectPathCandidates(value, key = "", sink = []) {
  if (typeof value === "string") {
    if (PATH_KEY_PATTERN.test(key)) {
      sink.push(value);
    }
    return sink;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPathCandidates(entry, key, sink);
    }
    return sink;
  }

  if (!value || typeof value !== "object") {
    return sink;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    collectPathCandidates(childValue, childKey, sink);
  }

  return sink;
}

function detectGitConfigMutation(command) {
  if (!/\bgit\s+config\b/i.test(command)) {
    return false;
  }

  if (/\bnpm\s+run\s+hooks:sync\b/i.test(command) || /tools\/hook-runtime\/src\/install\.ts/.test(command)) {
    return false;
  }

  if (!PROTECTED_GIT_KEYS.some((key) => command.includes(key))) {
    return false;
  }

  if (/\b(--get(?:-all)?|--show-origin|--list|-l)\b/i.test(command)) {
    return false;
  }

  if (/\b(--unset(?:-all)?|--replace-all|--add)\b/i.test(command)) {
    return true;
  }

  for (const key of PROTECTED_GIT_KEYS) {
    const escapedKey = key.replace(".", "\\.");
    const match = command.match(new RegExp(`\\b${escapedKey}\\b(?<tail>[\\s\\S]*)`, "i"));
    if (!match) {
      continue;
    }

    const tail = match.groups?.tail ?? "";
    if (/^\s*(?:$|[;&|])/.test(tail)) {
      continue;
    }

    return true;
  }

  return /\btest@test\.com\b/i.test(command);
}

function detectProtectedPathShellMutation(command) {
  if (/\bnpm\s+run\s+hooks:sync\b/i.test(command)) {
    return false;
  }

  const protectedPathPattern =
    "(?:\\.git\\/config|\\.git\\/hooks(?:\\/|\\b)|\\.husky(?:\\/|\\b)|\\.codex\\/hooks\\.json|\\.claude\\/settings(?:\\.local)?\\.json|\\.qoder\\/settings\\.json|docs\\/fitness\\/runtime\\/agent-hooks\\.yaml|scripts\\/check-tool-permission\\.js|scripts\\/check-prompt-policy\\.js|scripts\\/check-git-control-plane\\.js|scripts\\/lib\\/agent-hook-policy\\.js|scripts\\/lib\\/git-control-plane-doctor\\.js|tools\\/hook-runtime\\/src\\/install\\.ts)";

  const redirectPattern = new RegExp(`(?:>|>>)\\s*['"]?${protectedPathPattern}`, "i");
  const teePattern = new RegExp(`\\btee\\b[^\\n\\r]*['"]?${protectedPathPattern}`, "i");
  const mutatingVerbPattern = new RegExp(
    `\\b(?:cp|mv|rm|touch|chmod|chown|install|ln)\\b[^\\n\\r]*['"]?${protectedPathPattern}`,
    "i",
  );
  const inplacePattern = new RegExp(
    `\\b(?:sed|perl)\\b[^\\n\\r]*\\s-i(?:\\S*)?[^\\n\\r]*['"]?${protectedPathPattern}`,
    "i",
  );

  return (
    redirectPattern.test(command) ||
    teePattern.test(command) ||
    mutatingVerbPattern.test(command) ||
    inplacePattern.test(command)
  );
}

export function evaluateToolPermissionGuard(rawInput, env = process.env) {
  if (isControlPlaneBypassEnabled(env)) {
    return null;
  }

  const payload = safeParseJson(rawInput);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const cwd = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
  const toolInput = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};

  if (toolName === "Bash") {
    const command = typeof toolInput.command === "string" ? toolInput.command : "";
    for (const rule of SHELL_MUTATION_PATTERNS) {
      if (rule.test(command)) {
        return { reason: rule.reason };
      }
    }
    return null;
  }

  if (!/^(Write|Edit|MultiEdit)$/i.test(toolName)) {
    return null;
  }

  const candidates = collectPathCandidates(toolInput);
  for (const candidate of candidates) {
    const protectedLabel = getProtectedPathLabel(candidate, cwd);
    if (protectedLabel) {
      return {
        reason: `Writes to protected control-plane path \`${protectedLabel}\` are blocked by default. Set ROUTA_ALLOW_CONTROL_PLANE_MUTATION=1 for an intentional override.`,
      };
    }
  }

  return null;
}

export function evaluatePromptPolicyGuard(rawInput, env = process.env) {
  if (isControlPlaneBypassEnabled(env)) {
    return null;
  }

  const payload = safeParseJson(rawInput);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt) {
    return null;
  }

  if (PROMPT_MUTATION_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return {
      reason:
        "Prompts that directly instruct control-plane git/hook mutations are blocked by default. Ask for the mechanism or remediation path instead, or set ROUTA_ALLOW_CONTROL_PLANE_MUTATION=1 for an intentional override.",
    };
  }

  return null;
}
