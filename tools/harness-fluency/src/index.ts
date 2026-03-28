import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LEGACY_ENTRYPOINT = "node --import tsx tools/harness-fluency/src/cli.ts";
const ROUTA_ARGS_PREFIX = ["run", "-p", "routa-cli", "--", "fitness", "fluency"] as const;

export function normalizeLegacyArgs(argv: readonly string[]): string[] {
  if (argv[0] === "fluency" || argv[0] === "run") {
    return argv.slice(1);
  }
  return [...argv];
}

export function renderHelp(): string {
  return [
    "Harness Fluency legacy wrapper",
    "",
    `Deprecated entrypoint: ${LEGACY_ENTRYPOINT}`,
    "Canonical command: cargo run -p routa-cli -- fitness fluency [options]",
    "",
    "Supported legacy options are forwarded to routa-cli, including:",
    "  --format <text|json>",
    "  --json",
    "  --profile <generic|agent_orchestrator|orchestrator>",
    "  --repo-root <path>",
    "  --model <path>",
    "  --snapshot-path <path>",
    "  --compare-last",
    "  --no-save",
    "  -h, --help",
  ].join("\n");
}

export function buildCargoArgs(argv: readonly string[]): string[] {
  return [...ROUTA_ARGS_PREFIX, ...normalizeLegacyArgs(argv)];
}

export function shouldShowHelp(argv: readonly string[]): boolean {
  const normalized = normalizeLegacyArgs(argv);
  return normalized.includes("--help") || normalized.includes("-h");
}

export async function runCli(argv: readonly string[]): Promise<number> {
  if (shouldShowHelp(argv)) {
    console.error(renderHelp());
    return 0;
  }

  console.error(
    "tools/harness-fluency is deprecated; forwarding to `cargo run -p routa-cli -- fitness fluency`.",
  );

  return await new Promise<number>((resolve, reject) => {
    const child = spawn("cargo", buildCargoArgs(argv), {
      cwd: WORKSPACE_ROOT,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        reject(new Error(`legacy harness-fluency wrapper terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
