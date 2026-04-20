import { execFile } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  FeatureTreeMetadata,
  FeatureTreePreflightResult,
  GenerateFeatureTreeResult,
} from "@/core/spec/feature-tree-generator";

const execFileAsync = promisify(execFile);
const FEATURE_TREE_CLI_MAX_BUFFER = 10 * 1024 * 1024;
const WORKSPACE_ROOT = process.cwd();

function resolveRustCliInvocation(): { command: string; args: string[] } {
  const overridePath = process.env.ROUTA_FEATURE_TREE_CLI_PATH?.trim();
  if (overridePath) {
    return {
      command: path.resolve(overridePath),
      args: [],
    };
  }

  const binaryCandidates = [
    path.join(WORKSPACE_ROOT, "target", "debug", "routa"),
    path.join(WORKSPACE_ROOT, "target", "release", "routa"),
  ];

  for (const candidate of binaryCandidates) {
    if (path.isAbsolute(candidate)) {
      try {
        fsSync.accessSync(candidate);
        return {
          command: candidate,
          args: [],
        };
      } catch {
        continue;
      }
    }
  }

  return {
    command: "cargo",
    args: ["run", "-q", "-p", "routa-cli", "--"],
  };
}

async function runFeatureTreeCliJson<T>(args: string[]): Promise<T> {
  const invocation = resolveRustCliInvocation();
  const { stdout, stderr } = await execFileAsync(
    invocation.command,
    [...invocation.args, "feature-tree", ...args],
    {
      cwd: WORKSPACE_ROOT,
      maxBuffer: FEATURE_TREE_CLI_MAX_BUFFER,
    },
  );

  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    const details = stderr.trim() || stdout.trim() || (error instanceof Error ? error.message : String(error));
    throw new Error(`Feature tree CLI returned invalid JSON: ${details}`, { cause: error });
  }
}

export async function preflightFeatureTreeViaCli(repoRoot: string): Promise<FeatureTreePreflightResult> {
  return runFeatureTreeCliJson<FeatureTreePreflightResult>([
    "preflight",
    "--repo-path",
    repoRoot,
    "--json-output",
  ]);
}

export async function generateFeatureTreeViaCli(options: {
  repoRoot: string;
  scanRoot?: string;
  dryRun?: boolean;
}): Promise<GenerateFeatureTreeResult> {
  const args = [
    "generate",
    "--repo-path",
    options.repoRoot,
    "--json-output",
  ];

  if (options.scanRoot) {
    args.push("--scan-root", options.scanRoot);
  }
  if (options.dryRun) {
    args.push("--dry-run");
  }

  return runFeatureTreeCliJson<GenerateFeatureTreeResult>(args);
}

export async function commitFeatureTreeViaCli(options: {
  repoRoot: string;
  scanRoot?: string;
  metadata?: FeatureTreeMetadata | null;
}): Promise<GenerateFeatureTreeResult> {
  const args = [
    "commit",
    "--repo-path",
    options.repoRoot,
    "--json-output",
  ];

  if (options.scanRoot) {
    args.push("--scan-root", options.scanRoot);
  }

  let tempDir: string | null = null;
  try {
    if (options.metadata != null) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "feature-tree-cli-"));
      const metadataPath = path.join(tempDir, "metadata.json");
      await fs.writeFile(metadataPath, JSON.stringify(options.metadata), "utf8");
      args.push("--metadata-file", metadataPath);
    }

    return await runFeatureTreeCliJson<GenerateFeatureTreeResult>(args);
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
