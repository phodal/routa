#!/usr/bin/env node
/**
 * Build a distributable desktop backend bundle.
 *
 * Output:
 *   apps/desktop/src-tauri/bundled/desktop-server
 *
 * Contents are based on Next.js standalone output so Tauri can ship
 * a self-contained server payload (still requiring a local Node runtime).
 */
import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

function run(cmd, env = {}) {
  execSync(cmd, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

console.log("[build-desktop-bundle] Building Next desktop standalone output...");
run("npx next build", {
  ROUTA_DESKTOP_SERVER_BUILD: "1",
  ROUTA_DESKTOP_STANDALONE: "1",
});

if (!existsSync(standaloneDir)) {
  throw new Error(`Standalone output not found: ${standaloneDir}`);
}

console.log("[build-desktop-bundle] Preparing bundle directory...");
rmSync(bundleRoot, { recursive: true, force: true });
ensureDir(bundleRoot);

console.log("[build-desktop-bundle] Copying standalone server payload...");
cpSync(standaloneDir, bundleRoot, { recursive: true });

const targetNextStatic = path.join(bundleRoot, ".next", "static");
ensureDir(path.dirname(targetNextStatic));
if (existsSync(staticDir)) {
  cpSync(staticDir, targetNextStatic, { recursive: true });
}

if (existsSync(publicDir)) {
  cpSync(publicDir, path.join(bundleRoot, "public"), { recursive: true });
}

console.log("[build-desktop-bundle] Done.");
