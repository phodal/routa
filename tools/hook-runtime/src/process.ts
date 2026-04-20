import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type CommandResult = {
  command: string;
  durationMs: number;
  exitCode: number;
  output: string;
};

export type CommandOutputEvent = {
  stream: "stdout" | "stderr";
  text: string;
};

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onOutput?: (event: CommandOutputEvent) => void;
  stream?: boolean;
  timeoutMs?: number;
};

export function tailOutput(output: string, maxChars = 6000): string {
  return output.length <= maxChars ? output : output.slice(-maxChars);
}

export function runCommand(command: string, options: RunCommandOptions = {}): Promise<CommandResult> {
  const startedAt = Date.now();
  const shell = process.platform === "win32" ? "bash.exe" : "/bin/bash";

  // On Windows git-bash, login shells (-l) source .bash_profile which
  // re-imports Windows user env vars via PowerShell; the PowerShell output
  // carries \r\n line-endings, leaving TEMP/TMP with a trailing \r that
  // breaks Node.js mkdtemp (EINVAL/ENOENT).  Prepend an inline fix that
  // runs *after* .bash_profile has been sourced.
  const finalCommand = process.platform === "win32"
    ? `TEMP=$(printf '%s' "$TEMP" | tr -d '\\r') TMP=$(printf '%s' "$TMP" | tr -d '\\r') ${command}`
    : command;

  const child = spawn(shell, ["-lc", finalCommand], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["inherit", "pipe", "pipe"],
  });
  let timeoutId: NodeJS.Timeout | undefined;
  let timedOut = false;

  if (options.timeoutMs && options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    }, options.timeoutMs);
    timeoutId.unref();
  }

  let output = "";

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    options.onOutput?.({ stream: "stdout", text });
    if (options.stream !== false) {
      process.stdout.write(text);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    options.onOutput?.({ stream: "stderr", text });
    if (options.stream !== false) {
      process.stderr.write(text);
    }
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (timedOut) {
        output += `\n[hook-runtime] Command timed out after ${options.timeoutMs}ms\n`;
      }
      resolve({
        command,
        durationMs: Date.now() - startedAt,
        exitCode: timedOut ? 124 : (exitCode ?? 1),
        output,
      });
    });
  });
}

function repoRootFromCwd(cwd: string): string {
  return cwd;
}

export function resolveEntrixShellCommand(args: string[], cwd = process.cwd()): string {
  const repoRoot = repoRootFromCwd(cwd);
  const debugBinary = path.join(repoRoot, "target", "debug", process.platform === "win32" ? "entrix.exe" : "entrix");
  if (fs.existsSync(debugBinary)) {
    return [shellQuote(debugBinary), ...args.map(shellQuote)].join(" ");
  }
  return [
    "cargo",
    "run",
    "-q",
    "-p",
    "entrix",
    "--",
    ...args.map(shellQuote),
  ].join(" ");
}

export function resolveEntrixExec(cwd = process.cwd()): { command: string; args: string[] } {
  const repoRoot = repoRootFromCwd(cwd);
  const debugBinary = path.join(repoRoot, "target", "debug", process.platform === "win32" ? "entrix.exe" : "entrix");
  if (fs.existsSync(debugBinary)) {
    return {
      command: debugBinary,
      args: [],
    };
  }
  return {
    command: "cargo",
    args: ["run", "-q", "-p", "entrix", "--"],
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
