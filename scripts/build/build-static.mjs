#!/usr/bin/env node
/**
 * Build script for Tauri static export.
 *
 * Next.js `output: 'export'` cannot include API routes (they require a server).
 * This script temporarily moves the API directory out of the way, runs the
 * static build, then restores it.
 */
import { spawnSync } from "child_process";
import { existsSync, renameSync, rmSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const requireFromRoot = createRequire(path.join(rootDir, "package.json"));
const apiDir = path.join(rootDir, "src/app/api");
const apiBackup = path.join(rootDir, "src/app/_api_excluded");
const wellKnownDir = path.join(rootDir, "src/app/.well-known");
const wellKnownBackup = path.join(rootDir, "src/app/_well-known_excluded");
const nextBuildDir = path.join(rootDir, ".next");
const pageSnapshotsBuildDir = path.join(rootDir, ".next-page-snapshots");
const staticExportDir = path.join(rootDir, "out");

function moveDir(from, to) {
  if (existsSync(from)) {
    renameSync(from, to);
  }
}

function removeGeneratedDir(targetDir) {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
}

function resolveLocalNextCli() {
  try {
    return requireFromRoot.resolve("next/dist/bin/next");
  } catch {
    return null;
  }
}

function runLocalNextBuild() {
  const nextCliPath = resolveLocalNextCli();
  const result = nextCliPath
    ? spawnSync(process.execPath, [nextCliPath, "build"], {
        cwd: rootDir,
        stdio: "inherit",
        env: { ...process.env, ROUTA_BUILD_STATIC: "1", SKIP_ENV_VALIDATION: "1" },
        shell: false,
      })
    : spawnSync("npm", ["exec", "--no", "--", "next", "build"], {
        cwd: rootDir,
        stdio: "inherit",
        env: { ...process.env, ROUTA_BUILD_STATIC: "1", SKIP_ENV_VALIDATION: "1" },
        shell: false,
      });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const code = typeof result.status === "number" ? result.status : 1;
    if (!nextCliPath) {
      throw new Error(
        `Command failed with status ${code}: npm exec --no -- next build. Root frontend dependencies may be missing; run \`npm ci\` first.`
      );
    }
    throw new Error(`Command failed with status ${code}: next build`);
  }
}

let buildFailed = false;

try {
  console.log("[build-static] Temporarily excluding API routes and .well-known...");
  moveDir(apiDir, apiBackup);
  moveDir(wellKnownDir, wellKnownBackup);
  removeGeneratedDir(nextBuildDir);
  removeGeneratedDir(pageSnapshotsBuildDir);
  removeGeneratedDir(staticExportDir);

  console.log("[build-static] Running Next.js static export...");
  runLocalNextBuild();

  console.log("[build-static] Static export completed successfully.");
} catch (err) {
  buildFailed = true;
  console.error("[build-static] Build failed:", err.message);
} finally {
  console.log("[build-static] Restoring API routes and .well-known...");
  moveDir(apiBackup, apiDir);
  moveDir(wellKnownBackup, wellKnownDir);

  if (buildFailed) {
    process.exit(1);
  }
}
