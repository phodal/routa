import { spawn } from "node:child_process";

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
};

export function tailOutput(output: string, maxChars = 6000): string {
  return output.length <= maxChars ? output : output.slice(-maxChars);
}

export function runCommand(command: string, options: RunCommandOptions = {}): Promise<CommandResult> {
  const startedAt = Date.now();
  const shell = process.platform === "win32" ? "bash.exe" : "/bin/bash";
  const child = spawn(shell, ["-lc", command], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["inherit", "pipe", "pipe"],
  });

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
      resolve({
        command,
        durationMs: Date.now() - startedAt,
        exitCode: exitCode ?? 1,
        output,
      });
    });
  });
}
