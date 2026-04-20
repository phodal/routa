#!/usr/bin/env node
/**
 * Build a distributable desktop backend bundle.
 *
 * Output:
 *   apps/desktop/src-tauri/bundled/desktop-server
 *
 * Contents are based on Next.js standalone output so Tauri can ship
 * a self-contained server payload (still requiring a local Node runtime).
 *
 * Additionally, the sqlite modules are compiled separately via esbuild
 * and placed at the path where the webpack chunk's eval("require")
 * resolves them at runtime. better-sqlite3 (with its native addon) is
 * copied into the standalone node_modules.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const requireFromRoot = createRequire(path.join(root, "package.json"));

const standaloneDir = path.join(root, ".next-desktop", "standalone");
const staticDir = path.join(root, ".next-desktop", "static");
const publicDir = path.join(root, "public");
const bundleRoot = path.join(
  root,
  "apps",
  "desktop",
  "src-tauri",
  "bundled",
  "desktop-server"
);

function resolveLocalCli(moduleId) {
  try {
    return requireFromRoot.resolve(moduleId);
  } catch {
    return null;
  }
}

function runNextBuild() {
  const nextCliPath = resolveLocalCli("next/dist/bin/next");
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // Commands are hardcoded and invoked without shell interpolation.
  const result = nextCliPath
    ? spawnSync(process.execPath, [nextCliPath, "build"], {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          ROUTA_DESKTOP_SERVER_BUILD: "1",
          ROUTA_DESKTOP_STANDALONE: "1",
        },
        shell: false,
      })
    : spawnSync("npm", ["exec", "--no", "--", "next", "build"], {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          ROUTA_DESKTOP_SERVER_BUILD: "1",
          ROUTA_DESKTOP_STANDALONE: "1",
        },
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

function runEsbuild(entry, outfile) {
  const esbuildCliPath = resolveLocalCli("esbuild/bin/esbuild");
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // Esbuild args are derived from internal constants for packaging.
  const result = esbuildCliPath
    ? spawnSync(process.execPath, [
        esbuildCliPath,
        entry,
        "--bundle",
        "--platform=node",
        "--format=cjs",
        "--external:better-sqlite3",
        `--outfile=${outfile}`,
      ], {
        cwd: root,
        stdio: "inherit",
        env: process.env,
        shell: false,
      })
    : spawnSync("npm", [
        "exec",
        "--no",
        "--",
        "esbuild",
        entry,
        "--bundle",
        "--platform=node",
        "--format=cjs",
        "--external:better-sqlite3",
        `--outfile=${outfile}`,
      ], {
        cwd: root,
        stdio: "inherit",
        env: process.env,
        shell: false,
      });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const code = typeof result.status === "number" ? result.status : 1;
    if (!esbuildCliPath) {
      throw new Error(
        `Command failed with status ${code}: npm exec --no -- esbuild ${entry}. Root frontend dependencies may be missing; run \`npm ci\` first.`
      );
    }
    throw new Error(`Command failed with status ${code}: esbuild ${entry}`);
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// ── Step 1: Build Next.js standalone output ──────────────────────────
console.log("[build-desktop-bundle] Building Next desktop standalone output...");
runNextBuild();

if (!existsSync(standaloneDir)) {
  throw new Error(`Standalone output not found: ${standaloneDir}`);
}

// ── Step 2: Prepare bundle directory ─────────────────────────────────
console.log("[build-desktop-bundle] Preparing bundle directory...");
rmSync(bundleRoot, { recursive: true, force: true });
ensureDir(bundleRoot);

console.log("[build-desktop-bundle] Copying standalone server payload...");
cpSync(standaloneDir, bundleRoot, { recursive: true });

const targetNextStatic = path.join(bundleRoot, ".next-desktop", "static");
ensureDir(path.dirname(targetNextStatic));
if (existsSync(staticDir)) {
  cpSync(staticDir, targetNextStatic, { recursive: true });
}

if (existsSync(publicDir)) {
  cpSync(publicDir, path.join(bundleRoot, "public"), { recursive: true });
}

// ── Step 3: Compile SQLite modules for the standalone bundle ─────────
// The webpack chunk that contains createSqliteSystem uses:
//   eval("require")("./db/sqlite")
//   eval("require")("./db/sqlite-stores")
// This resolves relative to the chunk file inside .next-desktop/server/chunks/.
// We use esbuild to compile the TypeScript sources into self-contained CJS
// bundles (with better-sqlite3 as an external), then place them at the path
// where the chunk expects them.

const chunksDir = path.join(bundleRoot, ".next-desktop", "server", "chunks");
const targetDbDir = path.join(chunksDir, "db");
ensureDir(targetDbDir);

const sqliteSources = [
  { entry: "src/core/db/sqlite-schema.ts", out: "sqlite-schema.js" },
  { entry: "src/core/db/sqlite.ts", out: "sqlite.js" },
  { entry: "src/core/db/sqlite-stores.ts", out: "sqlite-stores.js" },
];

console.log("[build-desktop-bundle] Compiling SQLite modules with esbuild...");
for (const { entry, out } of sqliteSources) {
  const outfile = path.join(targetDbDir, out);
  runEsbuild(entry, outfile);
  console.log(`  ✓ ${out}`);
}

// ── Step 4: Copy better-sqlite3 native module ────────────────────────
const betterSqliteSrc = path.join(root, "node_modules", "better-sqlite3");
const betterSqliteDst = path.join(bundleRoot, "node_modules", "better-sqlite3");

if (existsSync(betterSqliteSrc)) {
  console.log("[build-desktop-bundle] Copying better-sqlite3 (with native addon)...");
  ensureDir(betterSqliteDst);
  cpSync(betterSqliteSrc, betterSqliteDst, { recursive: true });

  // Also copy bindings (node-gyp-build resolves from better-sqlite3)
  const ngbSrc = path.join(root, "node_modules", "node-gyp-build");
  const ngbDst = path.join(bundleRoot, "node_modules", "node-gyp-build");
  if (existsSync(ngbSrc) && !existsSync(ngbDst)) {
    cpSync(ngbSrc, ngbDst, { recursive: true });
  }

  // Copy bindings dependency if present
  const bindingsSrc = path.join(root, "node_modules", "bindings");
  const bindingsDst = path.join(bundleRoot, "node_modules", "bindings");
  if (existsSync(bindingsSrc) && !existsSync(bindingsDst)) {
    cpSync(bindingsSrc, bindingsDst, { recursive: true });
  }

  // Copy file-uri-to-path (used by bindings)
  const furiSrc = path.join(root, "node_modules", "file-uri-to-path");
  const furiDst = path.join(bundleRoot, "node_modules", "file-uri-to-path");
  if (existsSync(furiSrc) && !existsSync(furiDst)) {
    cpSync(furiSrc, furiDst, { recursive: true });
  }

  console.log("  ✓ better-sqlite3 with native addon copied");
} else {
  console.warn(
    "[build-desktop-bundle] WARNING: better-sqlite3 not found in node_modules. " +
      "SQLite will fall back to in-memory storage."
  );
}

console.log("[build-desktop-bundle] Done.");
