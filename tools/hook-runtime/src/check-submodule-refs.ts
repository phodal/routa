import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function runCommand(args: string[]): { code: number; output: string } {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    // Windows: spawnSync without shell only resolves .exe, not .cmd
    shell: process.platform === "win32",
  });

  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function normalizeUrl(rawUrl: string): string {
  const match = /^git@github\.com:(.+)$/.exec(rawUrl);
  if (match) {
    return `https://github.com/${match[1]}`;
  }
  return rawUrl;
}

function parseSubmodulePathEntries(raw: string): Array<{ key: string; path: string }> {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, ...rest] = entry.split(" ");
      const submodulePath = rest.join(" ").trim();
      return { key, path: submodulePath };
    })
    .filter((item) => Boolean(item.key && item.path));
}

export type SubmoduleRefSummary = {
  found: boolean;
  checked: number;
  skipped: number;
  failures: string[];
};

export function summarizeSubmoduleFailures(summary: SubmoduleRefSummary): void {
  if (summary.failures.length === 0 && summary.found) {
    const skippedLabel = summary.skipped > 0 ? ` (${summary.skipped} skipped)` : "";
    console.log(`[submodule] All pinned submodule refs are reachable${skippedLabel}.`);
    return;
  }

  if (summary.failures.length === 0 && !summary.found) {
    console.log("[submodule] No submodule refs are configured, skipping.");
    return;
  }

  console.log(`[submodule] ${summary.failures.length} unreachable submodule ref(s) found.`);
  for (const failure of summary.failures) {
    console.log(`[submodule] ${failure}`);
  }
}

async function checkSubmoduleRefs(): Promise<SubmoduleRefSummary> {
  const gitmodulesPath = path.join(process.cwd(), ".gitmodules");
  if (!existsSync(gitmodulesPath)) {
    return { found: false, checked: 0, skipped: 0, failures: [] };
  }

  const listCommand = runCommand(["-c", `core.worktree=${process.cwd()}`, "config", "-f", gitmodulesPath, "--get-regexp", "^submodule\\..*\\.path$"]);

  if (listCommand.code !== 0 || !listCommand.output.trim()) {
    return { found: false, checked: 0, skipped: 0, failures: [] };
  }

  const entries = parseSubmodulePathEntries(listCommand.output);

  if (entries.length === 0) {
    return { found: false, checked: 0, skipped: 0, failures: [] };
  }

  console.log(`[submodule] Checking ${entries.length} pinned submodule refs...`);

  const tempRoot = mkdtempSync(path.join(tmpdir(), "routa-submodule-"));
  const failures: string[] = [];
  let checked = 0;
  let skipped = 0;

  try {
    for (const entry of entries) {
      const key = entry.key;
      const submodulePath = entry.path;
      const name = key.replace(/^submodule\./, "").replace(/\.path$/, "");

      const urlResult = runCommand(["-c", `core.worktree=${process.cwd()}`, "config", "-f", gitmodulesPath, "--get", `submodule.${name}.url`]);
      if (urlResult.code !== 0 || !urlResult.output.trim()) {
        skipped += 1;
        continue;
      }

      const shaResult = runCommand(["ls-tree", "HEAD", submodulePath]);
      if (shaResult.code !== 0 || !shaResult.output.trim()) {
        skipped += 1;
        continue;
      }

      const shaMatch = shaResult.output.split(/\s+/);
      const sha = shaMatch[2]?.trim();
      if (!sha) {
        skipped += 1;
        continue;
      }

      const remoteUrl = normalizeUrl(urlResult.output.trim());
      checked += 1;

      const probeDir = path.join(tempRoot, name);
      runCommand(["init", "--bare", probeDir]);

      const fetchResult = runCommand(["-C", probeDir, "fetch", "--depth=1", remoteUrl, sha]);
      if (fetchResult.code === 0) {
        continue;
      }

      failures.push(`${submodulePath} -> commit ${sha} unreachable on ${remoteUrl}`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  return {
    found: true,
    checked,
    skipped,
    failures,
  };
}

export async function runSubmoduleRefsCheck(): Promise<boolean> {
  const summary = await checkSubmoduleRefs();
  summarizeSubmoduleFailures(summary);
  return summary.failures.length === 0;
}

export async function runSubmoduleRefsCheckWithSummary(): Promise<SubmoduleRefSummary> {
  const summary = await checkSubmoduleRefs();
  summarizeSubmoduleFailures(summary);
  return summary;
}
